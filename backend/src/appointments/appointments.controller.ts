import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('appointments')
@UseGuards(SessionGuard)
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('mine') @Roles('PATIENT') mine(@Req() request: AuthenticatedRequest) { return this.appointments.myAppointments(request.actor!); }
  @Post() @Roles('PATIENT') book(@Req() request: AuthenticatedRequest, @Body() body: unknown) { return this.appointments.bookForPatient(request.actor!, body); }
  @Patch(':id/cancel') cancel(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) { return this.appointments.cancel(request.actor!, id, body); }
  @Patch(':id/reschedule') reschedule(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) { return this.appointments.reschedule(request.actor!, id, body); }
  @Patch(':id/status') @Roles('DOCTOR', 'RECEPTIONIST', 'ADMIN') status(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) { return this.appointments.updateStatus(request.actor!, id, body); }
  @Get('doctor/queue') @Roles('DOCTOR') doctorQueue(@Req() request: AuthenticatedRequest, @Query('date') date?: string) { return this.appointments.doctorQueue(request.actor!, date); }
}
