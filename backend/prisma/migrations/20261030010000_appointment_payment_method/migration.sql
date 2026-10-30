-- Store the patient's chosen payment route with the appointment.
CREATE TYPE appointment_payment_method AS ENUM ('PAY_AT_COUNTER', 'PAY_ONLINE');

ALTER TABLE appointments
  ADD COLUMN payment_method appointment_payment_method NOT NULL DEFAULT 'PAY_AT_COUNTER';
