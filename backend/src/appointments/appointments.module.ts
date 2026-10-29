import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SessionGuard } from '../auth/session.guard';

@Module({ controllers: [AppointmentsController], providers: [AppointmentsService, SessionGuard], exports: [AppointmentsService] })
export class AppointmentsModule {}
