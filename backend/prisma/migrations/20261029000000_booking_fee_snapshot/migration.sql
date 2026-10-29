-- PR1: fee snapshots. Non-destructive, safe for a database that already has Stage 2 rows.
-- Apply only after the matching Prisma fields are added to schema.prisma.
ALTER TABLE doctor_profiles
  ADD COLUMN new_visit_fee_minor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN follow_up_fee_minor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN fee_currency VARCHAR(3) NOT NULL DEFAULT 'INR';

ALTER TABLE appointments
  ADD COLUMN fee_amount_minor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN fee_currency VARCHAR(3) NOT NULL DEFAULT 'INR';

ALTER TABLE doctor_profiles
  ADD CONSTRAINT ck_doctor_profile_nonnegative_fees
  CHECK (new_visit_fee_minor >= 0 AND follow_up_fee_minor >= 0);

ALTER TABLE appointments
  ADD CONSTRAINT ck_appointment_nonnegative_fee CHECK (fee_amount_minor >= 0);
