import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { AppointmentsModule } from '../appointments/appointments.module';
import { SessionGuard } from '../auth/session.guard';

@Module({ imports: [AppointmentsModule], controllers: [StaffController], providers: [StaffService, SessionGuard] })
export class StaffModule {}
