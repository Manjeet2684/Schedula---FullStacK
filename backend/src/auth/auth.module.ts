import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

@Module({ controllers: [AuthController], providers: [AuthService, SessionGuard], exports: [SessionGuard, AuthService] })
export class AuthModule {}
