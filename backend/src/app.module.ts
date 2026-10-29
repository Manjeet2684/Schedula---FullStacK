import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { StaffModule } from './staff/staff.module';
import { PatientsModule } from './patients/patients.module';

@Module({ imports: [PrismaModule, HealthModule, AuthModule, CatalogModule, AppointmentsModule, StaffModule, PatientsModule] })
export class AppModule {}
