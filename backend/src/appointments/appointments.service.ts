import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedActor } from '../auth/session.guard';

type Tx = Prisma.TransactionClient;
type Body = Record<string, unknown>;
type VisitKind = 'NEW_VISIT' | 'FOLLOW_UP';

// Clinic timezone — configure via CLINIC_TZ env variable (IANA tz name, e.g. "Asia/Kolkata").
// Defaults to Asia/Kolkata if unset. Used for "has this session/slot already elapsed?" checks.
const CLINIC_TZ = process.env['CLINIC_TZ'] ?? 'Asia/Kolkata';

/** Return the current wall-clock Date interpreted in the clinic timezone. */
function nowInClinic(): Date { return new Date(); }

/**
 * Build a Date representing a session date + time-of-day in the clinic timezone.
 * `sessionDate` is a calendar date (UTC midnight from Prisma @db.Date).
 * `timeValue` is a @db.Time stored as 1970-01-01T<HH:mm:ss>.000Z.
 */
function sessionDateTime(sessionDate: Date, timeValue: Date): Date {
  // Extract YYYY-MM-DD from the session date in UTC (it is always stored as UTC midnight for a @db.Date)
  const datePart = sessionDate.toISOString().slice(0, 10);
  // Extract HH:mm:ss from the time value (stored as 1970-01-01T<time>Z by Prisma for @db.Time)
  const timePart = timeValue.toISOString().slice(11, 19);
  // Interpret the combined string in the clinic timezone via Intl
  const localStr = `${datePart}T${timePart}`;
  // Use Intl.DateTimeFormat to get the UTC offset for this instant in the clinic timezone
  const probe = new Date(`${localStr}Z`); // parse as UTC first as a probe
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // Format the probe time in the clinic timezone to find offset
  const parts = Object.fromEntries(formatter.formatToParts(probe).map((p) => [p.type, p.value]));
  // Build a UTC-anchored string from the local date/time parts and compute the offset
  const probedUtc = probe.getTime();
  const probedLocal = Date.UTC(
    Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']),
    Number(parts['hour']), Number(parts['minute']), Number(parts['second']),
  );
  const offsetMs = probedLocal - probedUtc;
  // Apply: actual UTC = local target time - offset
  return new Date(Date.UTC(
    Number(datePart.slice(0, 4)), Number(datePart.slice(5, 7)) - 1, Number(datePart.slice(8, 10)),
    Number(timePart.slice(0, 2)), Number(timePart.slice(3, 5)), Number(timePart.slice(6, 8)),
  ) - offsetMs);
}

function text(body: Body, key: string, max = 500): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new BadRequestException(`${key} is required.`);
  return v.trim();
}
function visitKind(value: unknown): VisitKind {
  if (value !== 'NEW_VISIT' && value !== 'FOLLOW_UP') throw new BadRequestException('visitKind must be NEW_VISIT or FOLLOW_UP.');
  return value;
}
function bookingReference(): string { return `SCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(7).toString('hex').toUpperCase()}`; }
function roleIs(actor: AuthenticatedActor, ...allowed: string[]) { return actor.roles.some((role) => allowed.includes(role)); }
function conflictFromUnique(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') throw new ConflictException('This booking conflicts with an existing appointment. Refresh availability and try again.');
  throw error;
}

// Suppress unused type warning — Tx is referenced in inline comments for clarity
void (undefined as unknown as Tx);

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async myAppointments(actor: AuthenticatedActor) {
    if (!actor.patientId) throw new ForbiddenException('This account does not have a patient profile.');
    return this.prisma.appointment.findMany({
      where: { OR: [{ patientId: actor.patientId }, { patient: { is: { userId: null, registeredByUserId: actor.id } } }] },
      include: { doctor: { include: { profile: true, specializations: { include: { specialization: true } } } }, session: true, timedSlot: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
  }

  async bookForPatient(actor: AuthenticatedActor, raw: unknown) {
    if (!actor.patientId) throw new ForbiddenException('A patient profile is required to book an appointment.');
    const body = (raw ?? {}) as Body;
    const requestedPatientId = typeof body['patientId'] === 'string' && body['patientId'].trim() ? body['patientId'].trim() : actor.patientId;
    return this.book(actor, requestedPatientId, body, 'WEB_PATIENT');
  }

  async bookForStaff(actor: AuthenticatedActor, raw: unknown) {
    if (!roleIs(actor, 'RECEPTIONIST', 'ADMIN')) throw new ForbiddenException('Receptionist or admin access is required.');
    const body = (raw ?? {}) as Body;
    const patientId = text(body, 'patientId', 64);
    return this.book(actor, patientId, body, 'RECEPTION_DESK');
  }

  private async book(actor: AuthenticatedActor, patientId: string, raw: unknown, channel: 'WEB_PATIENT' | 'RECEPTION_DESK') {
    const body = (raw ?? {}) as Body;
    const allocationId = text(body, 'allocationId', 64);
    const kind = visitKind(body['visitKind']);
    const reasonForVisit = typeof body['reasonForVisit'] === 'string' ? body['reasonForVisit'].trim().slice(0, 4000) || null : null;
    if (channel === 'WEB_PATIENT' && body['poolType'] !== undefined && body['poolType'] !== 'ADVANCE_BOOKING') throw new BadRequestException('Online bookings must use the advance-booking pool.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const patient = await tx.patient.findUnique({ where: { id: patientId } });
        if (!patient) throw new NotFoundException('Patient record not found.');
        if (channel === 'WEB_PATIENT' && patient.userId !== actor.id && !(patient.userId === null && patient.registeredByUserId === actor.id)) throw new ForbiddenException('You can only book for your own profile or dependents you registered.');

        const allocationSeed = await tx.slotAllocation.findUnique({ where: { id: allocationId } });
        if (!allocationSeed) throw new NotFoundException('Selected availability is no longer available.');
        // Lock session before its allocation. This serializes token assignment and keeps a single lock order.
        await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM elastic_sessions WHERE id = ${allocationSeed.sessionId}::uuid FOR UPDATE`;
        await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM slot_allocations WHERE id = ${allocationId}::uuid FOR UPDATE`;
        const allocation = await tx.slotAllocation.findUnique({ where: { id: allocationId } });
        if (!allocation) throw new NotFoundException('Selected availability no longer exists.');
        if (channel === 'WEB_PATIENT' && allocation.poolType !== 'ADVANCE_BOOKING') throw new BadRequestException('Online bookings must use advance-booking capacity.');
        if (allocation.bookedCount >= allocation.maxCapacity) throw new ConflictException('This slot has just filled. Choose another available time.');

        const session = await tx.elasticSession.findUnique({ where: { id: allocation.sessionId }, include: { doctor: { include: { profile: true } } } });
        if (!session || !['SCHEDULED', 'ACTIVE'].includes(session.status)) throw new ConflictException('This clinic session is not accepting bookings.');
        const now = nowInClinic();
        // Reject if the session end time has already passed in the clinic timezone
        if (sessionDateTime(session.sessionDate, session.endTime) <= now) throw new ConflictException('This clinic session has already ended.');
        if (!session.doctor.isActiveForBooking || session.doctor.onboardingStatus !== 'APPROVED') throw new ConflictException('This doctor is not accepting bookings.');
        if (session.sessionMode === 'TOKEN_SESSION' && allocation.timedSlotId !== null) throw new BadRequestException('Token sessions use session-level allocations.');
        if (session.sessionMode === 'TIMED_SESSION' && !allocation.timedSlotId) throw new BadRequestException('Timed sessions require a timed-slot allocation.');
        if (allocation.timedSlotId) {
          const slot = await tx.sessionTimedSlot.findUnique({ where: { id: allocation.timedSlotId } });
          if (!slot || slot.sessionId !== session.id || slot.status !== 'AVAILABLE') throw new ConflictException('This timed slot is no longer available.');
          // Reject if this specific timed slot has already elapsed
          if (sessionDateTime(session.sessionDate, slot.slotEndTime) <= now) throw new ConflictException('This appointment time has already passed.');
        }
        const duplicate = await tx.appointment.findFirst({ where: { patientId, sessionId: session.id, status: { not: 'CANCELLED' } } });
        if (duplicate) throw new ConflictException('This patient already has an active appointment in this session.');

        const consumed = await tx.slotAllocation.updateMany({ where: { id: allocation.id, bookedCount: { lt: allocation.maxCapacity } }, data: { bookedCount: { increment: 1 }, version: { increment: 1 } } });
        if (consumed.count !== 1) throw new ConflictException('This slot has just filled. Choose another available time.');

        let tokenNumber: number | null = null;
        if (session.sessionMode === 'TOKEN_SESSION') {
          const updatedSession = await tx.elasticSession.update({ where: { id: session.id }, data: { lastIssuedToken: { increment: 1 }, version: { increment: 1 } } });
          tokenNumber = updatedSession.lastIssuedToken;
        }
        const feeAmountMinor = kind === 'NEW_VISIT' ? (session.doctor.profile?.newVisitFeeMinor ?? 0) : (session.doctor.profile?.followUpFeeMinor ?? 0);
        const feeCurrency = session.doctor.profile?.feeCurrency ?? 'INR';
        const appointment = await tx.appointment.create({
          data: {
            bookingReference: bookingReference(), patientId, doctorId: session.doctorId, sessionId: session.id,
            allocationId: allocation.id, timedSlotId: allocation.timedSlotId, poolType: allocation.poolType,
            tokenNumber, visitKind: kind, channel, status: 'BOOKED', reasonForVisit, bookedByUserId: actor.id,
            feeAmountMinor, feeCurrency,
          },
          include: { doctor: { include: { profile: true } }, session: true, timedSlot: true, patient: { select: { id: true, givenName: true, familyName: true, contactPhone: true, patientCode: true } } },
        });
        return appointment;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
    } catch (error) { return conflictFromUnique(error); }
  }

  async cancel(actor: AuthenticatedActor, appointmentId: string, raw: unknown) {
    const body = (raw ?? {}) as Body;
    const reason = text(body, 'reason', 1000);
    return this.prisma.$transaction(async (tx) => {
      const seed = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!seed) throw new NotFoundException('Appointment not found.');
      await this.assertAppointmentAccess(actor, seed.patientId, seed.doctorId);
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM elastic_sessions WHERE id = ${seed.sessionId}::uuid FOR UPDATE`;
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM slot_allocations WHERE id = ${seed.allocationId}::uuid FOR UPDATE`;
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`;
      const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!current) throw new NotFoundException('Appointment not found.');
      if (current.status === 'CANCELLED') return current; // idempotent: do not decrement twice
      if (!['BOOKED', 'CHECKED_IN'].includes(current.status)) throw new ConflictException('This appointment can no longer be cancelled.');
      const decrement = await tx.slotAllocation.updateMany({ where: { id: current.allocationId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 }, version: { increment: 1 } } });
      if (decrement.count !== 1) throw new ConflictException('Capacity accounting needs administrator review; cancellation was not applied.');
      return tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByRole: roleIs(actor, 'ADMIN') ? 'SYSTEM' : roleIs(actor, 'RECEPTIONIST') ? 'RECEPTIONIST' : roleIs(actor, 'DOCTOR') ? 'DOCTOR' : 'PATIENT', cancellationReason: reason },
        include: { doctor: { include: { profile: true } }, session: true, timedSlot: true, patient: { select: { id: true, givenName: true, familyName: true, contactPhone: true, patientCode: true } } },
      });
    });
  }

  async reschedule(actor: AuthenticatedActor, appointmentId: string, raw: unknown) {
    const body = (raw ?? {}) as Body;
    const newAllocationId = text(body, 'allocationId', 64);
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim().slice(0, 1000) || null : null;
    return this.prisma.$transaction(async (tx) => {
      const seed = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!seed) throw new NotFoundException('Appointment not found.');
      await this.assertAppointmentAccess(actor, seed.patientId, seed.doctorId);
      if (seed.status !== 'BOOKED') throw new ConflictException('Only booked appointments can be rescheduled.');
      const newAllocationSeed = await tx.slotAllocation.findUnique({ where: { id: newAllocationId } });
      if (!newAllocationSeed) throw new NotFoundException('The destination availability was not found.');
      const sessionIds = [...new Set([seed.sessionId, newAllocationSeed.sessionId])].sort();
      for (const sessionId of sessionIds) await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM elastic_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const allocationIds = [...new Set([seed.allocationId, newAllocationId])].sort();
      for (const id of allocationIds) await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM slot_allocations WHERE id = ${id}::uuid FOR UPDATE`;
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`;
      const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!current || current.status !== 'BOOKED') throw new ConflictException('Appointment changed while rescheduling; refresh and retry.');
      // Fix 4: verify the locks we acquired still match the appointment's actual state
      if (current.sessionId !== seed.sessionId || current.allocationId !== seed.allocationId) throw new ConflictException('Appointment was rescheduled concurrently; refresh and retry.');
      if (current.allocationId === newAllocationId) throw new BadRequestException('Choose a different time or allocation.');
      const newAllocation = await tx.slotAllocation.findUnique({ where: { id: newAllocationId } });
      const oldSession = await tx.elasticSession.findUnique({ where: { id: current.sessionId } });
      const newSession = newAllocation ? await tx.elasticSession.findUnique({ where: { id: newAllocation.sessionId } }) : null;
      if (!newAllocation || !newSession || !oldSession || newSession.doctorId !== current.doctorId || !['SCHEDULED', 'ACTIVE'].includes(newSession.status)) throw new ConflictException('Choose a future session for the same doctor.');
      // Fix 3: reject if the destination session has already ended
      const rescheduleNow = nowInClinic();
      if (sessionDateTime(newSession.sessionDate, newSession.endTime) <= rescheduleNow) throw new ConflictException('The destination session has already ended.');
      if (newAllocation.poolType !== 'ADVANCE_BOOKING') throw new BadRequestException('Patient rescheduling must use advance-booking capacity.');
      if (newAllocation.bookedCount >= newAllocation.maxCapacity) throw new ConflictException('The new time has just filled.');
      if (newSession.sessionMode === 'TOKEN_SESSION' && newAllocation.timedSlotId !== null) throw new BadRequestException('Token session allocation does not match session mode.');
      if (newSession.sessionMode === 'TIMED_SESSION' && !newAllocation.timedSlotId) throw new BadRequestException('Timed session allocation does not match session mode.');
      if (newAllocation.timedSlotId) {
        const slot = await tx.sessionTimedSlot.findUnique({ where: { id: newAllocation.timedSlotId } });
        if (!slot || slot.status !== 'AVAILABLE' || slot.sessionId !== newSession.id) throw new ConflictException('The new time is no longer available.');
        if (sessionDateTime(newSession.sessionDate, slot.slotEndTime) <= rescheduleNow) throw new ConflictException('The destination time slot has already passed.');
      }
      const duplicate = await tx.appointment.findFirst({ where: { id: { not: appointmentId }, patientId: current.patientId, sessionId: newSession.id, status: { not: 'CANCELLED' } } });
      if (duplicate) throw new ConflictException('This patient already has an active appointment in the destination session.');
      const reserve = await tx.slotAllocation.updateMany({ where: { id: newAllocation.id, bookedCount: { lt: newAllocation.maxCapacity } }, data: { bookedCount: { increment: 1 }, version: { increment: 1 } } });
      if (reserve.count !== 1) throw new ConflictException('The new time has just filled.');
      const release = await tx.slotAllocation.updateMany({ where: { id: current.allocationId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 }, version: { increment: 1 } } });
      if (release.count !== 1) throw new ConflictException('Old capacity accounting failed; transaction rolled back.');
      let tokenNumber: number | null = null;
      if (newSession.sessionMode === 'TOKEN_SESSION') tokenNumber = (await tx.elasticSession.update({ where: { id: newSession.id }, data: { lastIssuedToken: { increment: 1 }, version: { increment: 1 } } })).lastIssuedToken;
      const updated = await tx.appointment.update({ where: { id: appointmentId }, data: { sessionId: newSession.id, allocationId: newAllocation.id, timedSlotId: newAllocation.timedSlotId, poolType: newAllocation.poolType, tokenNumber }, include: { doctor: { include: { profile: true } }, session: true, timedSlot: true, patient: { select: { id: true, givenName: true, familyName: true, contactPhone: true, patientCode: true } } } });
      await tx.rescheduleHistory.create({ data: {
        appointmentId, previousSessionId: current.sessionId, previousAllocationId: current.allocationId, previousTimedSlotId: current.timedSlotId,
        previousPoolType: current.poolType, previousTokenNumber: current.tokenNumber, newSessionId: newSession.id, newAllocationId: newAllocation.id,
        newTimedSlotId: newAllocation.timedSlotId, newPoolType: newAllocation.poolType, newTokenNumber: tokenNumber,
        rescheduledByUserId: actor.id, initiatorRole: roleIs(actor, 'RECEPTIONIST') ? 'RECEPTIONIST' : roleIs(actor, 'DOCTOR') ? 'DOCTOR' : 'PATIENT', reason,
      } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 });
  }

  async doctorQueue(actor: AuthenticatedActor, dateText?: string) {
    if (!actor.doctorId) throw new ForbiddenException('A doctor profile is required.');
    const date = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    if (Number.isNaN(date.getTime())) throw new BadRequestException('date must use YYYY-MM-DD.');
    return this.prisma.appointment.findMany({ where: { doctorId: actor.doctorId, session: { sessionDate: date }, status: { not: 'CANCELLED' } }, include: { patient: { select: { id: true, givenName: true, familyName: true, contactPhone: true, patientCode: true } }, session: true, timedSlot: true }, orderBy: [{ tokenNumber: 'asc' }, { createdAt: 'asc' }] });
  }

  async updateStatus(actor: AuthenticatedActor, appointmentId: string, raw: unknown) {
    const body = (raw ?? {}) as Body;
    const next = text(body, 'status', 30);
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim().slice(0, 1000) || null : null;
    if (!['CHECKED_IN', 'IN_CONSULT', 'COMPLETED', 'NO_SHOW'].includes(next)) throw new BadRequestException('Unsupported status transition target.');
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { doctor: true } });
    if (!appt) throw new NotFoundException('Appointment not found.');
    await this.assertAppointmentAccess(actor, appt.patientId, appt.doctorId, true);
    if (roleIs(actor, 'DOCTOR') && appt.doctor.userId !== actor.id) throw new ForbiddenException('Doctors can only update their own appointments.');
    const allowed: Record<string, string[]> = { BOOKED: ['CHECKED_IN', 'NO_SHOW'], CHECKED_IN: ['IN_CONSULT', 'NO_SHOW'], IN_CONSULT: ['COMPLETED'] };
    if (!(allowed[appt.status] ?? []).includes(next)) throw new ConflictException(`Invalid appointment transition: ${appt.status} → ${next}.`);
    const data: Record<string, unknown> = { status: next };
    if (next === 'CHECKED_IN') data['checkedInAt'] = new Date();
    if (next === 'IN_CONSULT') data['consultStartedAt'] = new Date();
    if (next === 'COMPLETED') data['completedAt'] = new Date();
    if (next === 'NO_SHOW') { data['cancelledAt'] = null; data['cancellationReason'] = null; }
    if (reason && roleIs(actor, 'RECEPTIONIST', 'ADMIN')) data['reasonForVisit'] = appt.reasonForVisit ? `${appt.reasonForVisit}\nStaff note: ${reason}` : `Staff note: ${reason}`;
    // Fix 5: conditional update — only apply if the status has not changed concurrently
    const updated = await this.prisma.appointment.updateMany({
      where: { id: appointmentId, status: appt.status },
      data: data as never,
    });
    if (updated.count !== 1) throw new ConflictException(`Appointment status changed concurrently. Refresh and retry.`);
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { patient: { select: { id: true, givenName: true, familyName: true, contactPhone: true, patientCode: true } }, doctor: { include: { profile: true } }, session: true, timedSlot: true },
    });
  }

  async staffAppointments(actor: AuthenticatedActor, dateText?: string) {
    if (!roleIs(actor, 'RECEPTIONIST', 'ADMIN')) throw new ForbiddenException();
    const date = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    return this.prisma.appointment.findMany({ where: { session: { sessionDate: date } }, include: { patient: { select: { id: true, givenName: true, familyName: true, contactPhone: true, patientCode: true } }, doctor: { include: { profile: true } }, session: true, timedSlot: true }, orderBy: [{ tokenNumber: 'asc' }, { createdAt: 'asc' }] });
  }

  private async assertAppointmentAccess(actor: AuthenticatedActor, patientId: string, doctorId: string, allowOperationalStaff = false) {
    if (roleIs(actor, 'ADMIN', 'RECEPTIONIST') && allowOperationalStaff) return;
    if (roleIs(actor, 'ADMIN', 'RECEPTIONIST')) return;
    if (roleIs(actor, 'PATIENT')) {
      if (actor.patientId === patientId) return;
      const dependent = await this.prisma.patient.findFirst({ where: { id: patientId, userId: null, registeredByUserId: actor.id }, select: { id: true } });
      if (dependent) return;
    }
    if (roleIs(actor, 'DOCTOR') && actor.doctorId === doctorId) return;
    throw new ForbiddenException('You do not have access to this appointment.');
  }
}
