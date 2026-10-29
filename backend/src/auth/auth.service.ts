import { ConflictException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../database/prisma.service';
import { createSessionToken } from './session';

const scrypt = promisify(scryptCallback);
type Body = Record<string, unknown>;

function str(body: Body, key: string, min = 1, max = 500): string {
  const v = body[key];
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw new BadRequestException(`${key} is required and must be ${min}-${max} characters.`);
  return v.trim();
}
function emailValue(body: Body): string {
  const email = str(body, 'email', 5, 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+/.test(email)) throw new BadRequestException('Enter a valid email address.');
  return email;
}
function birthDate(body: Body): Date {
  const value = str(body, 'dateOfBirth', 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) throw new BadRequestException('dateOfBirth must use YYYY-MM-DD.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || parsed > new Date()) throw new BadRequestException('Enter a valid date of birth.');
  return parsed;
}

async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 200) throw new BadRequestException('Password must contain at least 10 characters.');
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function code(prefix: string): string { return `${prefix}-${randomBytes(7).toString('hex').toUpperCase()}`; }

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private safeUser(user: { id: string; email: string | null; roles: Array<{ role: string }>; patientRecord?: { id: string } | null; doctorRecord?: { id: string; onboardingStatus: string } | null }) {
    return { id: user.id, email: user.email, roles: user.roles.map((r) => r.role), patientId: user.patientRecord?.id ?? null, doctor: user.doctorRecord ? { id: user.doctorRecord.id, onboardingStatus: user.doctorRecord.onboardingStatus } : null };
  }

  async registerPatient(raw: unknown) {
    const body = (raw ?? {}) as Body;
    const email = emailValue(body);
    const passwordHash = await hashPassword(str(body, 'password', 10, 200));
    const givenName = str(body, 'givenName', 1, 120);
    const familyName = typeof body['familyName'] === 'string' ? body['familyName'].trim().slice(0, 120) || null : null;
    const contactPhone = str(body, 'contactPhone', 7, 32);
    const dateOfBirth = birthDate(body);
    const sex = ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'].includes(String(body['sex'])) ? String(body['sex']) as 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN' : 'UNKNOWN';
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, phone: contactPhone, passwordHash, status: 'ACTIVE' } });
        await tx.userRole.create({ data: { userId: created.id, role: 'PATIENT' } });
        await tx.patient.create({ data: { userId: created.id, patientCode: code('PAT'), givenName, familyName, sex, dateOfBirth, contactPhone } });
        return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: { roles: true, patientRecord: true, doctorRecord: true } });
      });
      return { token: createSessionToken(user.id), user: this.safeUser(user) };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') throw new ConflictException('An account with that email already exists.');
      throw error;
    }
  }

  async registerDoctor(raw: unknown) {
    const body = (raw ?? {}) as Body;
    const email = emailValue(body);
    const passwordHash = await hashPassword(str(body, 'password', 10, 200));
    const displayName = str(body, 'displayName', 2, 120);
    const qualifications = str(body, 'qualifications', 2, 500);
    const medicalCouncil = str(body, 'medicalCouncil', 2, 32);
    const registrationNumber = str(body, 'registrationNumber', 2, 64);
    const phone = str(body, 'phone', 7, 32);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, phone, passwordHash, status: 'ACTIVE' } });
        await tx.userRole.create({ data: { userId: created.id, role: 'DOCTOR' } });
        const doctor = await tx.doctor.create({ data: { userId: created.id, doctorCode: code('DOC'), medicalCouncil, registrationNumber, onboardingStatus: 'PENDING_VERIFICATION', isActiveForBooking: false } });
        await tx.doctorProfile.create({ data: { doctorId: doctor.id, displayName, qualifications, yearsOfExperience: 0, newVisitFeeMinor: 0, followUpFeeMinor: 0, feeCurrency: 'INR' } });
        return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: { roles: true, patientRecord: true, doctorRecord: true } });
      });
      return { token: createSessionToken(user.id), user: this.safeUser(user) };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') throw new ConflictException('This email or medical registration is already registered.');
      throw error;
    }
  }

  async login(raw: unknown) {
    const body = (raw ?? {}) as Body;
    const email = emailValue(body);
    const password = str(body, 'password', 1, 200);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { roles: true, patientRecord: true, doctorRecord: true } });
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException('Email or password is incorrect.');
    return { token: createSessionToken(user.id), user: this.safeUser(user) };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true, patientRecord: true, doctorRecord: true } });
    if (!user) throw new UnauthorizedException();
    return this.safeUser(user);
  }
}
