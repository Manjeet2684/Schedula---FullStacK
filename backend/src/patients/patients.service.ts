import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedActor } from '../auth/session.guard';

type Body = Record<string, unknown>;
function optionalText(body: Body, field: string, max: number): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException(`${field} must be a string of at most ${max} characters.`);
  return value.trim();
}
function dateValue(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('dateOfBirth must use YYYY-MM-DD.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || parsed > new Date()) throw new BadRequestException('Enter a valid date of birth in the past.');
  return parsed;
}
function validSex(value: unknown): 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN' | undefined {
  if (value === undefined) return undefined;
  if (value === 'FEMALE' || value === 'MALE' || value === 'OTHER' || value === 'UNKNOWN') return value;
  throw new BadRequestException('sex must be FEMALE, MALE, OTHER, or UNKNOWN.');
}
function patientCode() { return `PAT-${randomBytes(7).toString('hex').toUpperCase()}`; }

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  private async primary(actor: AuthenticatedActor) {
    if (!actor.patientId) throw new ForbiddenException('A patient profile is required.');
    const patient = await this.prisma.patient.findUnique({ where: { id: actor.patientId } });
    if (!patient || patient.userId !== actor.id) throw new ForbiddenException('Patient profile ownership could not be verified.');
    return patient;
  }

  async getProfile(actor: AuthenticatedActor) {
    const patient = await this.primary(actor);
    return { ...patient, id: patient.id, patientCode: patient.patientCode };
  }

  async updateProfile(actor: AuthenticatedActor, raw: unknown) {
    const patient = await this.primary(actor);
    const body = (raw ?? {}) as Body;
    const givenName = optionalText(body, 'givenName', 120);
    const familyName = optionalText(body, 'familyName', 120);
    const contactPhone = optionalText(body, 'contactPhone', 32);
    const alternatePhone = optionalText(body, 'alternatePhone', 32);
    const guardianName = optionalText(body, 'guardianName', 160);
    const email = optionalText(body, 'email', 255);
    const dateOfBirth = dateValue(body['dateOfBirth']);
    const sex = validSex(body['sex']);
    if (givenName !== undefined && !givenName) throw new BadRequestException('givenName cannot be blank.');
    if (contactPhone !== undefined && contactPhone.length < 7) throw new BadRequestException('contactPhone must contain at least 7 characters.');
    if (email !== undefined && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('email is invalid.');
    const patch: Record<string, unknown> = {};
    if (givenName !== undefined) patch['givenName'] = givenName;
    if (familyName !== undefined) patch['familyName'] = familyName || null;
    if (contactPhone !== undefined) patch['contactPhone'] = contactPhone;
    if (alternatePhone !== undefined) patch['alternatePhone'] = alternatePhone || null;
    if (guardianName !== undefined) patch['guardianName'] = guardianName || null;
    if (email !== undefined) patch['email'] = email || null;
    if (sex !== undefined) patch['sex'] = sex;
    if (body['whatsappOptIn'] !== undefined) {
      if (typeof body['whatsappOptIn'] !== 'boolean') throw new BadRequestException('whatsappOptIn must be a boolean.');
      patch['whatsappOptIn'] = body['whatsappOptIn'];
    }

    const ageWasSupplied = body['ageEstimatedYears'] !== undefined && body['ageEstimatedYears'] !== null && body['ageEstimatedYears'] !== '';
    if (dateOfBirth !== undefined && dateOfBirth !== null) {
      if (ageWasSupplied) throw new BadRequestException('Use date of birth or estimated age, not both.');
      patch['dateOfBirth'] = dateOfBirth;
      patch['ageEstimatedYears'] = null;
    } else if (ageWasSupplied || (dateOfBirth === null && !patient.dateOfBirth)) {
      if (dateOfBirth === null && !ageWasSupplied && patient.ageEstimatedYears === null) throw new BadRequestException('Supply a date of birth or estimated age.');
      const age = ageWasSupplied ? Number(body['ageEstimatedYears']) : patient.ageEstimatedYears;
      if (!Number.isInteger(age) || (age as number) < 0 || (age as number) > 130) throw new BadRequestException('ageEstimatedYears must be between 0 and 130.');
      patch['dateOfBirth'] = null;
      patch['ageEstimatedYears'] = age;
    }

    return this.prisma.$transaction(async (tx) => {
      if (contactPhone !== undefined) await tx.user.update({ where: { id: actor.id }, data: { phone: contactPhone } });
      return tx.patient.update({ where: { id: patient.id }, data: patch as never });
    });
  }

  async listDependents(actor: AuthenticatedActor) {
    await this.primary(actor);
    return this.prisma.patient.findMany({ where: { registeredByUserId: actor.id, userId: null }, select: { id: true, patientCode: true, givenName: true, familyName: true, sex: true, dateOfBirth: true, ageEstimatedYears: true, contactPhone: true, guardianName: true, whatsappOptIn: true }, orderBy: { createdAt: 'asc' } });
  }

  async createDependent(actor: AuthenticatedActor, raw: unknown) {
    const owner = await this.primary(actor);
    const body = (raw ?? {}) as Body;
    const givenName = optionalText(body, 'givenName', 120);
    if (!givenName) throw new BadRequestException('givenName is required.');
    const familyName = optionalText(body, 'familyName', 120) || null;
    const contactPhone = optionalText(body, 'contactPhone', 32) || owner.contactPhone;
    if (contactPhone.length < 7) throw new BadRequestException('contactPhone must contain at least 7 characters.');
    const dateOfBirth = dateValue(body['dateOfBirth']);
    const ageRaw = body['ageEstimatedYears'];
    let ageEstimatedYears: number | null = null;
    if (!dateOfBirth) {
      const age = Number(ageRaw);
      if (!Number.isInteger(age) || age < 0 || age > 130) throw new BadRequestException('Provide a valid date of birth or an estimated age from 0 to 130.');
      ageEstimatedYears = age;
    } else if (ageRaw !== undefined && ageRaw !== null && ageRaw !== '') throw new BadRequestException('Use date of birth or estimated age, not both.');
    const sex = validSex(body['sex']) ?? 'UNKNOWN';
    try {
      return await this.prisma.patient.create({ data: {
        patientCode: patientCode(), givenName, familyName, sex, dateOfBirth: dateOfBirth ?? null,
        ageEstimatedYears, contactPhone, guardianName: `${owner.givenName}${owner.familyName ? ` ${owner.familyName}` : ''}`,
        registeredByUserId: actor.id, whatsappOptIn: body['whatsappOptIn'] === true, userId: null,
      } });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') throw new ConflictException('Could not create this dependent. Check the details and retry.');
      throw error;
    }
  }

  async assertCanManagePatient(actor: AuthenticatedActor, patientId: string) {
    if (actor.patientId === patientId) return;
    const dependent = await this.prisma.patient.findFirst({ where: { id: patientId, userId: null, registeredByUserId: actor.id }, select: { id: true } });
    if (!dependent) throw new ForbiddenException('You can only manage your own profile and dependents you registered.');
  }
}
