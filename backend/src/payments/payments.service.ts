import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedActor } from '../auth/session.guard';

type JsonObject = Record<string, unknown>;
function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new InternalServerErrorException('Payment configuration ' + name + ' is missing.');
  return value;
}
function safeCompareHex(actualHex: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actualHex) || actualHex.length !== expectedHex.length || actualHex.length % 2 !== 0) return false;
  const a = Buffer.from(actualHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async razorpay(path: string, method: 'GET' | 'POST', body?: JsonObject): Promise<JsonObject> {
    const keyId = requiredEnv('RAZORPAY_KEY_ID');
    const keySecret = requiredEnv('RAZORPAY_KEY_SECRET');
    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1' + path, {
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new ConflictException('Payment provider is temporarily unreachable. Check payment status before retrying.');
    }
    const raw = await response.text();
    let payload: unknown;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok || !isRecord(payload)) throw new ConflictException('Payment provider rejected the request.');
    return payload;
  }

  async createOrder(actor: AuthenticatedActor, appointmentId: string) {
    if (!actor.patientId) throw new ForbiddenException('A patient profile is required.');
    if (!appointmentId || appointmentId.length > 64) throw new BadRequestException('A valid appointmentId is required.');

    // Lock by appointment to serialize order creation for concurrent browser requests.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`;
      const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) throw new NotFoundException('Appointment not found.');
      const patient = await tx.patient.findUnique({ where: { id: appointment.patientId }, select: { userId: true, registeredByUserId: true } });
      if (!patient || (appointment.patientId !== actor.patientId && !(patient.userId === null && patient.registeredByUserId === actor.id))) {
        throw new ForbiddenException('You can only pay for your own appointment or a dependent you registered.');
      }
      if (appointment.status !== 'BOOKED') throw new ConflictException('Only booked appointments can be paid online.');
      if (appointment.feeAmountMinor <= 0) throw new BadRequestException('This appointment has no payable fee.');

      const existing = await tx.payment.findFirst({
        where: { appointmentId: appointment.id, status: { in: ['CREATED', 'AUTHORIZED', 'CAPTURED', 'REFUND_PENDING', 'REFUNDED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        if (existing.status === 'CAPTURED' || existing.status === 'REFUND_PENDING' || existing.status === 'REFUNDED') {
          return { paymentId: existing.id, status: existing.status, amount: existing.amountMinor, currency: existing.currency };
        }
        return {
          paymentId: existing.id, orderId: existing.providerOrderId, amount: existing.amountMinor,
          currency: existing.currency, keyId: requiredEnv('RAZORPAY_KEY_ID'), status: existing.status,
        };
      }

      const order = await this.razorpay('/orders', 'POST', {
        amount: appointment.feeAmountMinor,
        currency: appointment.feeCurrency,
        receipt: ('SCH-' + appointment.bookingReference + '-' + randomBytes(3).toString('hex')).slice(0, 40),
        notes: { appointmentId: appointment.id, bookingReference: appointment.bookingReference },
      });
      if (typeof order['id'] !== 'string' || order['amount'] !== appointment.feeAmountMinor || order['currency'] !== appointment.feeCurrency) {
        throw new ConflictException('Payment provider returned an unexpected order response.');
      }
      const payment = await tx.payment.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          provider: 'RAZORPAY',
          providerOrderId: order['id'],
          amountMinor: appointment.feeAmountMinor,
          currency: appointment.feeCurrency,
          status: 'CREATED',
          idempotencyKey: 'appointment:' + appointment.id + ':order:' + order['id'],
        },
      });
      return { paymentId: payment.id, orderId: order['id'], amount: appointment.feeAmountMinor, currency: appointment.feeCurrency, keyId: requiredEnv('RAZORPAY_KEY_ID'), status: 'CREATED' };
    }, { maxWait: 5000, timeout: 20000 });
  }

  async verifyCheckout(actor: AuthenticatedActor, raw: unknown) {
    if (!actor.patientId) throw new ForbiddenException('A patient profile is required.');
    if (!isRecord(raw)) throw new BadRequestException('Invalid payment verification payload.');
    const orderId = typeof raw['razorpay_order_id'] === 'string' ? raw['razorpay_order_id'] : '';
    const providerPaymentId = typeof raw['razorpay_payment_id'] === 'string' ? raw['razorpay_payment_id'] : '';
    const signature = typeof raw['razorpay_signature'] === 'string' ? raw['razorpay_signature'] : '';
    if (!orderId || !providerPaymentId || !signature) throw new BadRequestException('Payment provider fields are required.');
    const expected = createHmac('sha256', requiredEnv('RAZORPAY_KEY_SECRET')).update(orderId + '|' + providerPaymentId).digest('hex');
    if (!safeCompareHex(signature, expected)) throw new UnauthorizedException('Payment signature is invalid.');

    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId }, include: { appointment: true } });
    if (!payment) throw new NotFoundException('Payment order not found.');
    const patient = await this.prisma.patient.findUnique({ where: { id: payment.patientId }, select: { userId: true, registeredByUserId: true } });
    if (payment.appointment.patientId !== actor.patientId && !(patient?.userId === null && patient.registeredByUserId === actor.id)) throw new ForbiddenException();

    const remote = await this.razorpay('/payments/' + encodeURIComponent(providerPaymentId), 'GET');
    if (remote['order_id'] !== orderId || remote['amount'] !== payment.amountMinor || remote['currency'] !== payment.currency) {
      throw new ConflictException('Payment details do not match the appointment order.');
    }
    if (remote['status'] !== 'captured') {
      if (remote['status'] === 'failed') {
        await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'CREATED' }, data: { providerPaymentId, status: 'FAILED' } });
      }
      throw new ConflictException('Payment has not been captured by Razorpay. It is not marked as paid.');
    }
    const updated = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { notIn: ['REFUNDED', 'REFUND_PENDING'] } },
      data: { providerPaymentId, status: 'CAPTURED', capturedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('Payment state changed concurrently. Check your payment history.');
    return { ok: true, status: 'CAPTURED', appointmentId: payment.appointmentId };
  }

  private verifyWebhook(rawBody: Buffer | undefined, signature: string | undefined): JsonObject {
    if (!rawBody || !signature) throw new UnauthorizedException('Missing webhook body or signature.');
    const expected = createHmac('sha256', requiredEnv('RAZORPAY_WEBHOOK_SECRET')).update(rawBody).digest('hex');
    if (!safeCompareHex(signature, expected)) throw new UnauthorizedException('Invalid webhook signature.');
    let event: unknown;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new BadRequestException('Invalid webhook JSON.'); }
    if (!isRecord(event)) throw new BadRequestException('Invalid webhook event.');
    return event;
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const event = this.verifyWebhook(rawBody, signature);
    const eventId = typeof event['id'] === 'string' ? event['id'] : '';
    const eventName = typeof event['event'] === 'string' ? event['event'] : '';
    if (!eventId || !eventName) throw new BadRequestException('Webhook event id and type are required.');
    const payload = isRecord(event['payload']) ? event['payload'] : {};
    const payPayload = isRecord(payload['payment']) ? payload['payment'] : {};
    const paymentEntity = isRecord(payPayload['entity']) ? payPayload['entity'] : {};
    const refundPayload = isRecord(payload['refund']) ? payload['refund'] : {};
    const refundEntity = isRecord(refundPayload['entity']) ? refundPayload['entity'] : {};
    const orderPayload = isRecord(payload['order']) ? payload['order'] : {};
    const orderEntity = isRecord(orderPayload['entity']) ? orderPayload['entity'] : {};
    const orderId = typeof paymentEntity['order_id'] === 'string' ? paymentEntity['order_id'] : (typeof orderEntity['id'] === 'string' ? orderEntity['id'] : '');
    const providerPaymentId = typeof paymentEntity['id'] === 'string' ? paymentEntity['id'] : (typeof refundEntity['payment_id'] === 'string' ? refundEntity['payment_id'] : '');
    const amount = typeof paymentEntity['amount'] === 'number' ? paymentEntity['amount'] : undefined;
    const currency = typeof paymentEntity['currency'] === 'string' ? paymentEntity['currency'] : undefined;
    let payment = orderId ? await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } }) : null;
    if (!payment && providerPaymentId) payment = await this.prisma.payment.findUnique({ where: { providerPaymentId } });
    // Return a retryable 409 if the local order is not committed yet; Razorpay retries non-2xx webhooks.
    if (!payment) throw new ConflictException('Payment record is not available yet. Provider should retry this webhook.');

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentWebhookEvent.create({ data: { providerEventId: eventId, eventType: eventName, paymentId: payment!.id, payload: event as never } });
        if (eventName === 'payment.captured' && providerPaymentId && amount === payment!.amountMinor && currency === payment!.currency) {
          await tx.payment.updateMany({ where: { id: payment!.id, status: { notIn: ['REFUNDED', 'REFUND_PENDING'] } }, data: { status: 'CAPTURED', providerPaymentId, capturedAt: new Date() } });
        } else if (eventName === 'payment.failed' && !['CAPTURED', 'REFUND_PENDING', 'REFUNDED'].includes(payment!.status)) {
          await tx.payment.updateMany({ where: { id: payment!.id, status: 'CREATED' }, data: { status: 'FAILED', providerPaymentId: providerPaymentId || null } });
        } else if (eventName === 'refund.processed') {
          await tx.payment.updateMany({
            where: { id: payment!.id, status: 'REFUND_PENDING' },
            data: {
              status: 'REFUNDED',
              ...(typeof refundEntity['id'] === 'string' ? { providerRefundId: refundEntity['id'] } : {}),
              refundedAt: new Date(),
            },
          });
        } else if (eventName === 'refund.failed') {
          await tx.payment.updateMany({ where: { id: payment!.id, status: 'REFUND_PENDING' }, data: { status: 'CAPTURED' } });
        }
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') return { ok: true, duplicate: true };
      throw error;
    }
    return { ok: true };
  }

  async listAdminPayments(actor: AuthenticatedActor) {
    if (!actor.roles.includes('ADMIN')) throw new ForbiddenException('Administrator access is required.');
    return this.prisma.payment.findMany({
      select: {
        id: true, appointmentId: true, patientId: true, amountMinor: true, currency: true, status: true,
        providerOrderId: true, providerPaymentId: true, createdAt: true, capturedAt: true, refundedAt: true,
        appointment: { select: { bookingReference: true } },
        patient: { select: { patientCode: true, givenName: true, familyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async listMyPayments(actor: AuthenticatedActor) {
    if (!actor.patientId) throw new ForbiddenException('A patient profile is required.');
    return this.prisma.payment.findMany({
      where: { patientId: actor.patientId },
      select: { id: true, appointmentId: true, amountMinor: true, currency: true, status: true, providerOrderId: true, providerPaymentId: true, createdAt: true, capturedAt: true, refundedAt: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
  }

  async adminRefund(actor: AuthenticatedActor, paymentId: string, raw: unknown) {
    if (!actor.roles.includes('ADMIN')) throw new ForbiddenException('Administrator access is required.');
    if (!isRecord(raw)) throw new BadRequestException('A refund reason is required.');
    const reason = typeof raw['reason'] === 'string' ? raw['reason'].trim().slice(0, 500) : '';
    if (reason.length < 3) throw new BadRequestException('A refund reason of at least 3 characters is required.');
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== 'CAPTURED' || !payment.providerPaymentId) throw new ConflictException('Only captured payments can be refunded.');

    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CAPTURED' },
      data: { status: 'REFUND_PENDING', refundReason: reason, refundRequestedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException('A refund is already underway or payment status changed.');

    // If the network outcome is ambiguous, leave REFUND_PENDING for reconciliation rather than risk a duplicate refund.
    const providerRefund = await this.razorpay('/payments/' + encodeURIComponent(payment.providerPaymentId) + '/refund', 'POST', {
      amount: payment.amountMinor,
      notes: { reason, paymentRecordId: payment.id, refundedBy: actor.id },
    });
    if (typeof providerRefund['id'] !== 'string') throw new ConflictException('Provider did not return a refund reference; leave pending and reconcile with Razorpay.');
    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'REFUND_PENDING' },
      data: { providerRefundId: providerRefund['id'] },
    });
    return { ok: true, status: 'REFUND_PENDING', providerRefundId: providerRefund['id'] };
  }
}
