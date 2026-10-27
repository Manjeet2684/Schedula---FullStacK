import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/v1/health
   *
   * Executes a real PostgreSQL query (SELECT 1) to verify database connectivity.
   * Returns HTTP 200 on success, HTTP 503 on database failure.
   * Never exposes connection strings, passwords, SQL details, or stack traces.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res() res: Response): Promise<void> {
    try {
      // Real database query — not a TCP socket check
      await this.prisma.$queryRaw`SELECT 1`;

      res.status(HttpStatus.OK).json({
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Safe error payload — no connection strings, passwords, SQL or stack traces
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        database: 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
