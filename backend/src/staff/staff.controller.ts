import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { StaffService } from './staff.service';
import { AppointmentsService } from '../appointments/appointments.service';

@Controller('staff')
@UseGuards(SessionGuard)
export class StaffController {
  constructor(private readonly staff: StaffService, private readonly appointments: AppointmentsService) {}

  @Get('patients') @Roles('RECEPTIONIST', 'ADMIN') searchPatients(@Req() req: AuthenticatedRequest, @Query('search') search?: string) { return this.staff.searchPatients(req.actor!, search); }
  @Post('patients') @Roles('RECEPTIONIST', 'ADMIN') createPatient(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.staff.createDeskPatient(req.actor!, body); }
  @Post('appointments') @Roles('RECEPTIONIST', 'ADMIN') assistedBooking(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.staff.assistedBooking(req.actor!, body); }
  @Get('appointments') @Roles('RECEPTIONIST', 'ADMIN') appointmentsForDate(@Req() req: AuthenticatedRequest, @Query('date') date?: string) { return this.appointments.staffAppointments(req.actor!, date); }
  @Get('availability') @Roles('RECEPTIONIST', 'ADMIN') availability(@Req() req: AuthenticatedRequest, @Query('doctorId') doctorId: string, @Query('date') date: string) { return this.staff.availability(req.actor!, doctorId, date); }

  @Post('doctor/sessions') @Roles('DOCTOR') createSession(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.staff.createDoctorSession(req.actor!, body); }
  @Get('admin/overview') @Roles('ADMIN') overview(@Req() req: AuthenticatedRequest) { return this.staff.overview(req.actor!); }
  @Get('admin/doctors/pending') @Roles('ADMIN') pendingDoctors(@Req() req: AuthenticatedRequest) { return this.staff.pendingDoctors(req.actor!); }
  @Patch('admin/doctors/:id/approve') @Roles('ADMIN') approveDoctor(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.staff.approveDoctor(req.actor!, id); }
  @Get('admin/doctors') @Roles('ADMIN') listAdminDoctors(@Req() req: AuthenticatedRequest) { return this.staff.listAdminDoctors(req.actor!); }
  @Get('admin/specializations') @Roles('ADMIN') listAdminSpecializations(@Req() req: AuthenticatedRequest) { return this.staff.listAdminSpecializations(req.actor!); }
  @Put('admin/doctors/:id/specializations') @Roles('ADMIN') assignDoctorSpecializations(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) { return this.staff.assignDoctorSpecializations(req.actor!, id, body); }
  @Get('admin/users') @Roles('ADMIN') listAdminUsers(@Req() req: AuthenticatedRequest) { return this.staff.listAdminUsers(req.actor!); }
  @Patch('admin/users/:id/role') @Roles('ADMIN') setStaffRole(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) { return this.staff.setStaffRole(req.actor!, id, body); }
  @Post('admin/specializations') @Roles('ADMIN') addSpecialization(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.staff.addSpecialization(req.actor!, body); }
  @Patch('admin/doctors/:id/fees') @Roles('ADMIN') updateFees(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) { return this.staff.updateFees(req.actor!, id, body); }
}
