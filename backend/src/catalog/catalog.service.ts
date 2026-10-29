import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// Clinic timezone — matches appointments.service.ts; configure via CLINIC_TZ env variable.
const CLINIC_TZ = process.env['CLINIC_TZ'] ?? 'Asia/Kolkata';

function sessionDateTime(sessionDate: Date, timeValue: Date): Date {
  const datePart = sessionDate.toISOString().slice(0, 10);
  const timePart = timeValue.toISOString().slice(11, 19);
  const probe = new Date(`${datePart}T${timePart}Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(probe).map((p) => [p.type, p.value]));
  const offsetMs = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']), Number(parts['second'])) - probe.getTime();
  return new Date(Date.UTC(Number(datePart.slice(0, 4)), Number(datePart.slice(5, 7)) - 1, Number(datePart.slice(8, 10)), Number(timePart.slice(0, 2)), Number(timePart.slice(3, 5)), Number(timePart.slice(6, 8))) - offsetMs);
}

function isoDate(value: string | undefined, field: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is not a valid calendar date.`);
  return result;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listSpecializations() {
    return this.prisma.specialization.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async listDoctors(query: { search?: string; specializationId?: string }) {
    const where: Record<string, unknown> = { isActiveForBooking: true, onboardingStatus: 'APPROVED' };
    if (query.specializationId) where['specializations'] = { some: { specializationId: query.specializationId } };
    if (query.search?.trim()) {
      const term = query.search.trim().slice(0, 100);
      where['OR'] = [
        { profile: { is: { displayName: { contains: term, mode: 'insensitive' } } } },
        { specializations: { some: { specialization: { name: { contains: term, mode: 'insensitive' } } } } },
      ];
    }
    const doctors = await this.prisma.doctor.findMany({
      where: where as never,
      include: { profile: true, specializations: { include: { specialization: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return doctors.map((doctor) => ({
      id: doctor.id,
      code: doctor.doctorCode,
      name: doctor.profile?.displayName ?? 'Doctor profile pending',
      qualifications: doctor.profile?.qualifications ?? '',
      bio: doctor.profile?.bio ?? '',
      yearsOfExperience: doctor.profile?.yearsOfExperience ?? 0,
      fees: { newVisitMinor: doctor.profile?.newVisitFeeMinor ?? 0, followUpMinor: doctor.profile?.followUpFeeMinor ?? 0, currency: doctor.profile?.feeCurrency ?? 'INR' },
      specializations: doctor.specializations.map((item) => ({ id: item.specialization.id, name: item.specialization.name, code: item.specialization.code, primary: item.isPrimary })),
    }));
  }

  async getDoctor(id: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { id, isActiveForBooking: true, onboardingStatus: 'APPROVED' },
      include: { profile: true, specializations: { include: { specialization: true } } },
    });
    if (!doctor) throw new NotFoundException('Doctor not found or not accepting bookings.');
    return {
      id: doctor.id, code: doctor.doctorCode, name: doctor.profile?.displayName ?? 'Doctor',
      qualifications: doctor.profile?.qualifications ?? '', bio: doctor.profile?.bio ?? '', yearsOfExperience: doctor.profile?.yearsOfExperience ?? 0,
      fees: { newVisitMinor: doctor.profile?.newVisitFeeMinor ?? 0, followUpMinor: doctor.profile?.followUpFeeMinor ?? 0, currency: doctor.profile?.feeCurrency ?? 'INR' },
      specializations: doctor.specializations.map((item) => ({ id: item.specialization.id, name: item.specialization.name, primary: item.isPrimary })),
    };
  }

  async getAvailability(doctorId: string, dateText: string) {
    const date = isoDate(dateText, 'date');
    const sessions = await this.prisma.elasticSession.findMany({
      where: { doctorId, sessionDate: date, status: { in: ['SCHEDULED', 'ACTIVE'] }, doctor: { isActiveForBooking: true, onboardingStatus: 'APPROVED' } },
      include: { allocations: true, timedSlots: true },
      orderBy: { startTime: 'asc' },
    });
    const now = new Date();
    return sessions.map((session) => {
      // Drop sessions whose end time has already passed in the clinic timezone
      if (sessionDateTime(session.sessionDate, session.endTime) <= now) return null;
      const slotById = new Map(session.timedSlots.map((slot) => [slot.id, slot]));
      const allocations = session.allocations
        .filter((allocation) => allocation.poolType === 'ADVANCE_BOOKING')
        .map((allocation) => {
          const timedSlot = allocation.timedSlotId ? slotById.get(allocation.timedSlotId) : undefined;
          // Drop timed-slot allocations whose slot end time has already passed
          if (timedSlot && sessionDateTime(session.sessionDate, timedSlot.slotEndTime) <= now) return null;
          return {
            id: allocation.id,
            poolType: allocation.poolType,
            timedSlotId: allocation.timedSlotId,
            slotStartTime: timedSlot?.slotStartTime ?? null,
            slotEndTime: timedSlot?.slotEndTime ?? null,
            slotStatus: timedSlot?.status ?? null,
            maxCapacity: allocation.maxCapacity,
            bookedCount: allocation.bookedCount,
            availableCount: Math.max(0, allocation.maxCapacity - allocation.bookedCount),
            bookable: allocation.bookedCount < allocation.maxCapacity && (!allocation.timedSlotId || timedSlot?.status === 'AVAILABLE'),
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null && a.bookable);
      return {
        id: session.id,
        date: session.sessionDate.toISOString().slice(0, 10),
        startTime: session.startTime.toISOString().slice(11, 19),
        endTime: session.endTime.toISOString().slice(11, 19),
        mode: session.sessionMode,
        queueOrder: session.queueOrder,
        status: session.status,
        allocations,
      };
    }).filter((session): session is NonNullable<typeof session> => session !== null && session.allocations.length > 0);
  }
}
