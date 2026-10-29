import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { readSessionToken, verifySessionToken } from './session';
import { REQUIRED_ROLES, AppRoleName } from './roles.decorator';

export interface AuthenticatedActor {
  id: string;
  email: string | null;
  roles: AppRoleName[];
  patientId: string | null;
  doctorId: string | null;
}
export type AuthenticatedRequest = Request & { actor?: AuthenticatedActor };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(request.headers.cookie, request.headers.authorization);
    if (!token) throw new UnauthorizedException('Sign in to continue.');
    const claims = verifySessionToken(token);
    if (!claims) throw new UnauthorizedException('Your session has expired. Sign in again.');
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { roles: true, patientRecord: true, doctorRecord: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('This account is not active.');

    const actor: AuthenticatedActor = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((role) => role.role as AppRoleName),
      patientId: user.patientRecord?.id ?? null,
      doctorId: user.doctorRecord?.id ?? null,
    };
    request.actor = actor;

    const required = this.reflector.getAllAndOverride<AppRoleName[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (required?.length && !required.some((role) => actor.roles.includes(role))) return false;
    return true;
  }
}
