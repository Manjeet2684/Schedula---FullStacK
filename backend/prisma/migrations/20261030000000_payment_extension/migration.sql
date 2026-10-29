-- PR2: Razorpay payment records. Apply only after PR1's fee migration.
CREATE TYPE payment_provider AS ENUM ('RAZORPAY');
CREATE TYPE payment_status AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  provider payment_provider NOT NULL,
  provider_order_id VARCHAR(80) NOT NULL UNIQUE,
  provider_payment_id VARCHAR(80) UNIQUE,
  provider_refund_id VARCHAR(80) UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency VARCHAR(3) NOT NULL,
  status payment_status NOT NULL DEFAULT 'CREATED',
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  refund_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ,
  refund_requested_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_patient_created ON payments(patient_id, created_at DESC);
CREATE INDEX idx_payments_appointment_created ON payments(appointment_id, created_at DESC);

CREATE TABLE payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id VARCHAR(100) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_webhook_events_payment ON payment_webhook_events(payment_id, received_at DESC);
