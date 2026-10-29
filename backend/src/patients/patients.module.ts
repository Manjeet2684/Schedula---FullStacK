import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { SessionGuard } from '../auth/session.guard';

@Module({ controllers: [PatientsController], providers: [PatientsService, SessionGuard], exports: [PatientsService] })
export class PatientsModule {}
