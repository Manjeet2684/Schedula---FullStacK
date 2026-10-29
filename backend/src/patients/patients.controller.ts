import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { PatientsService } from './patients.service';

@Controller('patients')
@UseGuards(SessionGuard)
@Roles('PATIENT')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get('me') profile(@Req() req: AuthenticatedRequest) { return this.patients.getProfile(req.actor!); }
  @Patch('me') updateProfile(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.patients.updateProfile(req.actor!, body); }
  @Get('me/dependents') dependents(@Req() req: AuthenticatedRequest) { return this.patients.listDependents(req.actor!); }
  @Post('me/dependents') createDependent(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.patients.createDependent(req.actor!, body); }
}
