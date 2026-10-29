import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, SessionGuard } from './session.guard';
import { clearSessionCookie, sessionCookie } from './session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.registerPatient(body);
    response.setHeader('Set-Cookie', sessionCookie(result.token));
    return { user: result.user };
  }

  @Post('register-doctor')
  async registerDoctor(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.registerDoctor(body);
    response.setHeader('Set-Cookie', sessionCookie(result.token));
    return { user: result.user, notice: 'Your profile is pending administrator verification and cannot be booked yet.' };
  }

  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body);
    response.setHeader('Set-Cookie', sessionCookie(result.token));
    return { user: result.user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Set-Cookie', clearSessionCookie);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.actor!.id);
  }
}
