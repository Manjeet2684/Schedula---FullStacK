import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedActor } from '../auth/session.guard';
import { AppointmentsService } from '../appointments/appointments.service';

type Body = Record<string, unknown>;
function s(body: Body, name: string, min = 1, max = 500): string {
  const value = body[name];
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new BadRequestException(`${name} is required.`);
  return value.trim();
}
function integer(value: unknown, name: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}
function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('date must use YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('date is invalid.');
  return date;
}
function timeMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new BadRequestException('Time must use HH:mm in 24-hour format.');
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function atTime(value: string): Date { return new Date(`1970-01-01T${value}:00.000Z`); }
function makeCode(prefix: string) { return `${prefix}-${randomBytes(7).toString('hex').toUpperCase()}`; }

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService, private readonly appointments: AppointmentsService) {}

  async searchPatients(actor: AuthenticatedActor, search = '') {
    this.requireStaff(actor);
    const term = search.trim().slice(0, 100);
    if (!term) return [];
    return this.prisma.patient.findMany({ where: { OR: [
      { patientCode: { contains: term, mode: 'insensitive' } },
      { givenName: { contains: term, mode: 'insensitive' } },
      { familyName: { contains: term, mode: 'insensitive' } },
      { contactPhone: { contains: term } },
      { oldFileNumber: { contains: term, mode: 'insensitive' } },
    ] }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, patientCode: true, givenName: true, familyName: true, contactPhone: true, dateOfBirth: true, ageEstimatedYears: true, sex: true } });
  }

  async createDeskPatient(actor: AuthenticatedActor, raw: unknown) {
    this.requireStaff(actor);
    const body = (raw ?? {}) as Body;
    const givenName = s(body, 'givenName', 1, 120);
    const familyName = typeof body['familyName'] === 'string' ? body['familyName'].trim().slice(0, 120) || null : null;
    const contactPhone = s(body, 'contactPhone', 7, 32);
    const dateOfBirth = typeof body['dateOfBirth'] === 'string' && body['dateOfBirth'] ? parseDate(body['dateOfBirth']) : null;
    const ageEstimatedYears = dateOfBirth ? null : integer(body['ageEstimatedYears'], 'ageEstimatedYears', 0, 130);
    const sex = ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'].includes(String(body['sex'])) ? String(body['sex']) as 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN' : 'UNKNOWN';
    return this.prisma.patient.create({ data: { patientCode: makeCode('PAT'), givenName, familyName, sex, contactPhone, dateOfBirth, ageEstimatedYears, registeredByUserId: actor.id, whatsappOptIn: body['whatsappOptIn'] === true } });
  }

  async assistedBooking(actor: AuthenticatedActor, raw: unknown) {
    return this.appointments.bookForStaff(actor, raw);
  }

  async availability(actor: AuthenticatedActor, doctorId: string, dateText: string) {
    this.requireStaff(actor);
    const date = parseDate(dateText);
    const sessions = await this.prisma.elasticSession.findMany({ where: { doctorId, sessionDate: date, status: { in: ['SCHEDULED', 'ACTIVE'] } }, include: { allocations: true, timedSlots: true }, orderBy: { startTime: 'asc' } });
    return sessions.map((session) => {
      const slots = new Map(session.timedSlots.map((slot) => [slot.id, slot]));
      return { id: session.id, date: session.sessionDate.toISOString().slice(0, 10), startTime: session.startTime.toISOString().slice(11, 16), endTime: session.endTime.toISOString().slice(11, 16), mode: session.sessionMode, allocations: session.allocations.map((a) => ({ id: a.id, poolType: a.poolType, timedSlotId: a.timedSlotId, startTime: a.timedSlotId ? slots.get(a.timedSlotId)?.slotStartTime.toISOString().slice(11, 16) : null, endTime: a.timedSlotId ? slots.get(a.timedSlotId)?.slotEndTime.toISOString().slice(11, 16) : null, maxCapacity: a.maxCapacity, bookedCount: a.bookedCount, availableCount: Math.max(0, a.maxCapacity - a.bookedCount), bookable: a.bookedCount < a.maxCapacity && (!a.timedSlotId || slots.get(a.timedSlotId)?.status === 'AVAILABLE') })) };
    });
  }

  async createDoctorSession(actor: AuthenticatedActor, raw: unknown) {
    if (!actor.doctorId) throw new ForbiddenException('Doctor profile required.');
    const body = (raw ?? {}) as Body;
    const dateText = s(body, 'date', 10, 10);
    const date = parseDate(dateText);
    const start = s(body, 'startTime', 5, 5);
    const end = s(body, 'endTime', 5, 5);
    const startM = timeMinutes(start), endM = timeMinutes(end);
    if (endM <= startM) throw new BadRequestException('endTime must be later than startTime.');
    const mode = body['mode'];
    if (mode !== 'TOKEN_SESSION' && mode !== 'TIMED_SESSION') throw new BadRequestException('mode must be TOKEN_SESSION or TIMED_SESSION.');
    const advance = integer(body['advanceCapacity'], 'advanceCapacity', 0, 500);
    const walkin = integer(body['walkInCapacity'], 'walkInCapacity', 0, 500);
    const duration = mode === 'TIMED_SESSION' ? integer(body['slotDurationMinutes'], 'slotDurationMinutes', 5, 240) : 0;
    if (advance + walkin < 1) throw new BadRequestException('Set at least one booking capacity.');
    if (mode === 'TIMED_SESSION' && (endM - startM) % duration !== 0) throw new BadRequestException('Session duration must be divisible by slotDurationMinutes.');
    const doctor = await this.prisma.doctor.findUnique({ where: { id: actor.doctorId } });
    if (!doctor || doctor.onboardingStatus !== 'APPROVED') throw new ForbiddenException('Only verified doctors can publish sessions.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const session = await tx.elasticSession.create({ data: { doctorId: actor.doctorId!, sessionDate: date, startTime: atTime(start), endTime: atTime(end), sessionMode: mode, queueOrder: mode === 'TOKEN_SESSION' ? 'BY_TOKEN' : 'BY_ARRIVAL', status: 'SCHEDULED' } });
        if (mode === 'TOKEN_SESSION') {
          await tx.slotAllocation.createMany({ data: [
            ...(advance > 0 ? [{ sessionId: session.id, poolType: 'ADVANCE_BOOKING' as const, maxCapacity: advance }] : []),
            ...(walkin > 0 ? [{ sessionId: session.id, poolType: 'WALK_IN_RESERVE' as const, maxCapacity: walkin }] : []),
          ] });
        } else {
          for (let minute = startM; minute < endM; minute += duration) {
            const slotStart = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
            const next = minute + duration;
            const slotEnd = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
            const slot = await tx.sessionTimedSlot.create({ data: { sessionId: session.id, slotStartTime: atTime(slotStart), slotEndTime: atTime(slotEnd), status: 'AVAILABLE' } });
            await tx.slotAllocation.createMany({ data: [
              ...(advance > 0 ? [{ sessionId: session.id, timedSlotId: slot.id, poolType: 'ADVANCE_BOOKING' as const, maxCapacity: advance }] : []),
              ...(walkin > 0 ? [{ sessionId: session.id, timedSlotId: slot.id, poolType: 'WALK_IN_RESERVE' as const, maxCapacity: walkin }] : []),
            ] });
          }
        }
        return session;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2004'].includes(String((error as { code?: string }).code))) throw new ConflictException('This schedule conflicts with an existing session or database rule.');
      throw error;
    }
  }

  async pendingDoctors(actor: AuthenticatedActor) {
    this.requireAdmin(actor);
    return this.prisma.doctor.findMany({ where: { onboardingStatus: 'PENDING_VERIFICATION' }, include: { user: { select: { id: true, email: true, phone: true } }, profile: true }, orderBy: { createdAt: 'asc' } });
  }

  async approveDoctor(actor: AuthenticatedActor, doctorId: string) {
    this.requireAdmin(actor);
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new NotFoundException('Doctor not found.');
    return this.prisma.doctor.update({ where: { id: doctorId }, data: { onboardingStatus: 'APPROVED', isActiveForBooking: true, credentialsVerifiedAt: new Date(), verifiedByUserId: actor.id }, include: { profile: true, user: { select: { email: true } } } });
  }

  async addSpecialization(actor: AuthenticatedActor, raw: unknown) {
    this.requireAdmin(actor);
    const body = (raw ?? {}) as Body;
    const name = s(body, 'name', 2, 120);
    const code = s(body, 'code', 2, 32).toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
    const description = typeof body['description'] === 'string' ? body['description'].trim().slice(0, 2000) || null : null;
    try { return await this.prisma.specialization.create({ data: { name, code, description, isActive: true } }); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') throw new ConflictException('A specialization with that name or code already exists.'); throw error; }
  }

  async listAdminDoctors(actor: AuthenticatedActor) {
    this.requireAdmin(actor);
    const rows = await this.prisma.doctor.findMany({ include: { profile: true, specializations: { include: { specialization: true } }, user: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((doctor) => ({ id: doctor.id, name: doctor.profile?.displayName ?? 'Doctor', qualifications: doctor.profile?.qualifications ?? '', fees: { newVisitMinor: doctor.profile?.newVisitFeeMinor ?? 0, followUpMinor: doctor.profile?.followUpFeeMinor ?? 0, currency: doctor.profile?.feeCurrency ?? 'INR' }, email: doctor.user.email, onboardingStatus: doctor.onboardingStatus, specializations: doctor.specializations.map((link) => ({ id: link.specializationId, name: link.specialization.name, primary: link.isPrimary })) }));
  }

  async listAdminSpecializations(actor: AuthenticatedActor) {
    this.requireAdmin(actor);
    return this.prisma.specialization.findMany({ orderBy: { name: 'asc' } });
  }

  async assignDoctorSpecializations(actor: AuthenticatedActor, doctorId: string, raw: unknown) {
    this.requireAdmin(actor);
    const body = (raw ?? {}) as Body;
    const supplied = body['specializationIds'];
    if (!Array.isArray(supplied) || supplied.length > 12 || supplied.some((id) => typeof id !== 'string')) throw new BadRequestException('specializationIds must be an array of up to 12 specialization IDs.');
    const ids = [...new Set(supplied as string[])];
    const rawPrimary = body['primarySpecializationId'];
    const primary = rawPrimary === undefined || rawPrimary === null || rawPrimary === '' ? null : rawPrimary;
    if (primary !== null && (typeof primary !== 'string' || !ids.includes(primary))) throw new BadRequestException('primarySpecializationId must be one of the assigned specialization IDs.');
    return this.prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.findUnique({ where: { id: doctorId } });
      if (!doctor) throw new NotFoundException('Doctor not found.');
      const found = await tx.specialization.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
      if (found.length !== ids.length) throw new BadRequestException('One or more specialization IDs are invalid or inactive.');
      await tx.doctorSpecialization.deleteMany({ where: { doctorId } });
      if (ids.length) await tx.doctorSpecialization.createMany({ data: ids.map((specializationId) => ({ doctorId, specializationId, isPrimary: specializationId === primary })) });
      return tx.doctor.findUnique({ where: { id: doctorId }, include: { profile: true, specializations: { include: { specialization: true } } } });
    });
  }

  async listAdminUsers(actor: AuthenticatedActor) {
    this.requireAdmin(actor);
    const rows = await this.prisma.user.findMany({ select: { id: true, email: true, phone: true, status: true, createdAt: true, roles: { select: { role: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((user) => ({ ...user, roles: user.roles.map((role) => role.role) }));
  }

  async setStaffRole(actor: AuthenticatedActor, userId: string, raw: unknown) {
    this.requireAdmin(actor);
    const body = (raw ?? {}) as Body;
    const role = body['role'];
    const enabled = body['enabled'];
    if (role !== 'RECEPTIONIST' && role !== 'ADMIN') throw new BadRequestException('Only RECEPTIONIST and ADMIN staff roles may be managed here.');
    if (typeof enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean.');
    if (userId === actor.id && role === 'ADMIN' && !enabled) throw new ConflictException('You cannot remove your own administrator role.');
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: true } });
      if (!user) throw new NotFoundException('User not found.');
      if (enabled) await tx.userRole.upsert({ where: { userId_role: { userId, role } }, create: { userId, role }, update: {} });
      else {
        if (role === 'ADMIN' && user.roles.filter((item) => item.role === 'ADMIN').length === 1) {
          const adminCount = await tx.userRole.count({ where: { role: 'ADMIN' } });
          if (adminCount <= 1) throw new ConflictException('At least one administrator account must remain.');
        }
        await tx.userRole.deleteMany({ where: { userId, role } });
      }
      return tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, roles: { select: { role: true } } } });
    });
  }

  async updateFees(actor: AuthenticatedActor, doctorId: string, raw: unknown) {
    this.requireAdmin(actor);
    const body = (raw ?? {}) as Body;
    const newVisitFeeMinor = integer(body['newVisitFeeMinor'], 'newVisitFeeMinor', 0, 100_000_000);
    const followUpFeeMinor = integer(body['followUpFeeMinor'], 'followUpFeeMinor', 0, 100_000_000);
    const currency = typeof body['feeCurrency'] === 'string' ? body['feeCurrency'].toUpperCase() : 'INR';
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('feeCurrency must be a 3-letter currency code.');
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new NotFoundException('Doctor not found.');
    return this.prisma.doctorProfile.update({ where: { doctorId }, data: { newVisitFeeMinor, followUpFeeMinor, feeCurrency: currency } });
  }

  async overview(actor: AuthenticatedActor) {
    this.requireAdmin(actor);
    const [doctors, patients, appointments, pendingDoctors] = await Promise.all([
      this.prisma.doctor.count(), this.prisma.patient.count(), this.prisma.appointment.count(), this.prisma.doctor.count({ where: { onboardingStatus: 'PENDING_VERIFICATION' } }),
    ]);
    return { doctors, patients, appointments, pendingDoctors };
  }

  private requireStaff(actor: AuthenticatedActor) { if (!actor.roles.some((r) => ['RECEPTIONIST', 'ADMIN'].includes(r))) throw new ForbiddenException('Receptionist or admin access required.'); }
  private requireAdmin(actor: AuthenticatedActor) { if (!actor.roles.includes('ADMIN')) throw new ForbiddenException('Administrator access required.'); }
}
