import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES = 'schedula:required-roles';
export type AppRoleName = 'PATIENT' | 'DOCTOR' | 'RECEPTIONIST' | 'ADMIN';
export const Roles = (...roles: AppRoleName[]) => SetMetadata(REQUIRED_ROLES, roles);
