import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SessionGuard } from '../auth/session.guard';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, SessionGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}
