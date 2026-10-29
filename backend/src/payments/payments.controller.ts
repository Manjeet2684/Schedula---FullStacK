import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() request: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    return this.payments.handleWebhook(request.rawBody, signature);
  }

  @Post('orders')
  @UseGuards(SessionGuard)
  @Roles('PATIENT')
  createOrder(@Req() request: AuthenticatedRequest, @Body() body: { appointmentId?: string }) {
    return this.payments.createOrder(request.actor!, body?.appointmentId ?? '');
  }

  @Post('verify')
  @UseGuards(SessionGuard)
  @Roles('PATIENT')
  verify(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.verifyCheckout(request.actor!, body);
  }

  @Get('mine')
  @UseGuards(SessionGuard)
  @Roles('PATIENT')
  mine(@Req() request: AuthenticatedRequest) {
    return this.payments.listMyPayments(request.actor!);
  }

  @Get('admin')
  @UseGuards(SessionGuard)
  @Roles('ADMIN')
  adminList(@Req() request: AuthenticatedRequest) {
    return this.payments.listAdminPayments(request.actor!);
  }

  @Post(':id/refund')
  @UseGuards(SessionGuard)
  @Roles('ADMIN')
  refund(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.payments.adminRefund(request.actor!, id, body);
  }
}
