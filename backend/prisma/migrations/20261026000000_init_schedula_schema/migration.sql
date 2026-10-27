-- ============================================================
-- Schedula — Initial Schema Migration
-- Migration: 20261026000000_init_schedula_schema
-- PostgreSQL 17
-- ============================================================
-- This migration creates all 17 tables, enum types, indexes,
-- constraints, and database triggers for the Schedula Stage 2
-- foundation.
--
-- It is designed to be reproducible against a clean PostgreSQL 17
-- database. Run via:  prisma migrate deploy
-- ============================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_account_status AS ENUM (
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED'
);

CREATE TYPE oauth_provider AS ENUM (
  'GOOGLE'
);

CREATE TYPE app_role AS ENUM (
  'PATIENT',
  'DOCTOR',
  'RECEPTIONIST',
  'ADMIN'
);

CREATE TYPE verification_token_purpose AS ENUM (
  'EMAIL_VERIFY',
  'PHONE_OTP',
  'DOCTOR_INVITE',
  'PASSWORD_RESET'
);

CREATE TYPE sex_type AS ENUM (
  'FEMALE',
  'MALE',
  'OTHER',
  'UNKNOWN'
);

CREATE TYPE doctor_onboarding_status AS ENUM (
  'DRAFT',
  'PENDING_VERIFICATION',
  'APPROVED',
  'SUSPENDED'
);

CREATE TYPE scheduling_mode AS ENUM (
  'TOKEN_SESSION',
  'TIMED_SESSION'
);

CREATE TYPE queue_ordering_rule AS ENUM (
  'BY_TOKEN',
  'BY_ARRIVAL'
);

CREATE TYPE exception_type AS ENUM (
  'LEAVE',
  'HOLIDAY',
  'EMERGENCY_CLOSURE',
  'CUSTOM_HOURS'
);

CREATE TYPE session_lifecycle_status AS ENUM (
  'SCHEDULED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE allocation_pool_type AS ENUM (
  'ADVANCE_BOOKING',
  'WALK_IN_RESERVE',
  'OVERRIDE_OVERFLOW'
);

CREATE TYPE timed_slot_status AS ENUM (
  'AVAILABLE',
  'BLOCKED_BY_SHRINK',
  'CANCELLED'
);

CREATE TYPE visit_type AS ENUM (
  'NEW_VISIT',
  'FOLLOW_UP'
);

CREATE TYPE booking_channel_type AS ENUM (
  'WEB_PATIENT',
  'RECEPTION_DESK',
  'WHATSAPP_BOT'
);

CREATE TYPE appointment_status AS ENUM (
  'BOOKED',
  'CHECKED_IN',
  'IN_CONSULT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
);

CREATE TYPE cancellation_actor_type AS ENUM (
  'PATIENT',
  'DOCTOR',
  'RECEPTIONIST',
  'SYSTEM'
);

CREATE TYPE reschedule_initiator_type AS ENUM (
  'PATIENT',
  'DOCTOR',
  'RECEPTIONIST',
  'SYSTEM_ELASTIC'
);

CREATE TYPE notification_channel AS ENUM (
  'EMAIL',
  'WHATSAPP',
  'SMS',
  'IN_APP'
);

CREATE TYPE notification_event_type AS ENUM (
  'BOOKING_CONFIRMED',
  'REMINDER_24H',
  'REMINDER_1H',
  'DOCTOR_DELAY',
  'RESCHEDULED',
  'CANCELLED_BY_DOCTOR',
  'CANCELLED_BY_PATIENT',
  'SLOT_REENGAGEMENT'
);

CREATE TYPE notification_delivery_status AS ENUM (
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED'
);

-- ============================================================
-- USER MODULE
-- ============================================================

CREATE TABLE users (
  id                UUID                  NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email             VARCHAR(255)          UNIQUE,
  phone             VARCHAR(32),
  password_hash     VARCHAR(255),
  status            user_account_status   NOT NULL DEFAULT 'PENDING_VERIFICATION',
  is_email_verified BOOLEAN               NOT NULL DEFAULT false,
  is_phone_verified BOOLEAN               NOT NULL DEFAULT false,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),

  -- Require at least one of email or phone
  CONSTRAINT users_require_email_or_phone
    CHECK (email IS NOT NULL OR phone IS NOT NULL),

  -- Enforce lowercase email storage
  CONSTRAINT users_email_lowercase
    CHECK (email IS NULL OR email = lower(email))
);

CREATE INDEX idx_users_phone ON users (phone);

-- ── oauth_accounts ──────────────────────────────────────────

CREATE TABLE oauth_accounts (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID          NOT NULL,
  provider            oauth_provider NOT NULL,
  provider_account_id VARCHAR(255)  NOT NULL,
  provider_email      VARCHAR(255),
  linked_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT fk_oauth_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

  CONSTRAINT uq_oauth_provider_account
    UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts (user_id);

-- ── user_roles ───────────────────────────────────────────────

CREATE TABLE user_roles (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID        NOT NULL,
  role              app_role    NOT NULL,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by_user_id UUID,

  CONSTRAINT fk_user_role_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

  CONSTRAINT fk_user_role_granted_by
    FOREIGN KEY (granted_by_user_id) REFERENCES users (id) ON DELETE SET NULL,

  CONSTRAINT uq_user_role
    UNIQUE (user_id, role)
);

-- ── verification_tokens ──────────────────────────────────────

CREATE TABLE verification_tokens (
  id            UUID                         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID                         NOT NULL,
  purpose       verification_token_purpose   NOT NULL,
  target        VARCHAR(255)                 NOT NULL,
  token_hash    VARCHAR(128)                 NOT NULL,
  expires_at    TIMESTAMPTZ                  NOT NULL,
  consumed_at   TIMESTAMPTZ,
  attempt_count INTEGER                      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ                  NOT NULL DEFAULT now(),

  CONSTRAINT fk_verification_token_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,

  -- token_hash is NOT globally unique: duplicate short OTPs across records are permitted
  CONSTRAINT ck_verification_token_attempt_count
    CHECK (attempt_count >= 0),

  CONSTRAINT ck_verification_token_expiry
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_verification_tokens_lookup
  ON verification_tokens (user_id, purpose, target, expires_at);

-- ============================================================
-- PATIENT MODULE
-- ============================================================

CREATE TABLE patients (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID        UNIQUE,
  patient_code          VARCHAR(32) NOT NULL UNIQUE,
  given_name            VARCHAR(120) NOT NULL,
  family_name           VARCHAR(120),
  sex                   sex_type    NOT NULL,
  date_of_birth         DATE,
  age_estimated_years   SMALLINT,
  contact_phone         VARCHAR(32) NOT NULL,
  alternate_phone       VARCHAR(32),
  email                 VARCHAR(255),
  guardian_name         VARCHAR(160),
  old_file_number       VARCHAR(64),
  whatsapp_opt_in       BOOLEAN     NOT NULL DEFAULT false,
  registered_by_user_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_patient_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,

  CONSTRAINT fk_patient_registered_by
    FOREIGN KEY (registered_by_user_id) REFERENCES users (id) ON DELETE SET NULL,

  -- Either date_of_birth or age_estimated_years must be present
  CONSTRAINT ck_patient_age_or_dob
    CHECK (date_of_birth IS NOT NULL OR age_estimated_years IS NOT NULL),

  -- Estimated age range
  CONSTRAINT ck_patient_age_estimated_range
    CHECK (age_estimated_years IS NULL OR (age_estimated_years >= 0 AND age_estimated_years <= 130))
);

-- contact_phone is indexed but NOT unique (family members may share a guardian's phone)
CREATE INDEX idx_patients_contact_phone ON patients (contact_phone);
CREATE INDEX idx_patients_name ON patients (given_name, family_name);
CREATE INDEX idx_patients_old_file_number ON patients (old_file_number);

-- ============================================================
-- DOCTOR MODULE
-- ============================================================

CREATE TABLE doctors (
  id                      UUID                    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID                    NOT NULL UNIQUE,
  doctor_code             VARCHAR(32)             NOT NULL UNIQUE,
  onboarding_status       doctor_onboarding_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  medical_council         VARCHAR(32)             NOT NULL,
  registration_number     VARCHAR(64)             NOT NULL,
  credentials_verified_at TIMESTAMPTZ,
  verified_by_user_id     UUID,
  is_active_for_booking   BOOLEAN                 NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),

  CONSTRAINT fk_doctor_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT fk_doctor_verified_by
    FOREIGN KEY (verified_by_user_id) REFERENCES users (id) ON DELETE SET NULL,

  CONSTRAINT uq_doctor_medical_registration
    UNIQUE (medical_council, registration_number),

  -- is_active_for_booking = true implies onboarding_status = APPROVED
  CONSTRAINT ck_doctor_active_requires_approved
    CHECK (
      is_active_for_booking = false
      OR onboarding_status = 'APPROVED'
    ),

  -- APPROVED requires credentials_verified_at and verified_by_user_id
  CONSTRAINT ck_doctor_approved_requires_verification
    CHECK (
      onboarding_status <> 'APPROVED'
      OR (credentials_verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL)
    )
);

-- ── doctor_profiles ──────────────────────────────────────────

CREATE TABLE doctor_profiles (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id           UUID        NOT NULL UNIQUE,
  display_name        VARCHAR(120) NOT NULL,
  qualifications      VARCHAR(500) NOT NULL,
  bio                 TEXT,
  years_of_experience INTEGER     NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_doctor_profile_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE,

  CONSTRAINT ck_doctor_profile_years_experience
    CHECK (years_of_experience >= 0)
);

-- ── specializations ──────────────────────────────────────────

CREATE TABLE specializations (
  id          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code        VARCHAR(32)  NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT true
);

-- ── doctor_specializations ───────────────────────────────────

CREATE TABLE doctor_specializations (
  doctor_id          UUID        NOT NULL,
  specialization_id  UUID        NOT NULL,
  is_primary         BOOLEAN     NOT NULL DEFAULT false,
  assigned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_doctor_specializations
    PRIMARY KEY (doctor_id, specialization_id),

  CONSTRAINT fk_doctor_spec_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE,

  CONSTRAINT fk_doctor_spec_specialization
    FOREIGN KEY (specialization_id) REFERENCES specializations (id) ON DELETE RESTRICT
);

-- At most one primary specialization per doctor
CREATE UNIQUE INDEX idx_doctor_specializations_one_primary
  ON doctor_specializations (doctor_id)
  WHERE is_primary = true;

-- ============================================================
-- AVAILABILITY MODULE
-- ============================================================

CREATE TABLE recurring_availability_rules (
  id                       UUID                NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id                UUID                NOT NULL,
  day_of_week              SMALLINT            NOT NULL,
  start_time               TIME                NOT NULL,
  end_time                 TIME                NOT NULL,
  session_mode             scheduling_mode     NOT NULL,
  queue_order              queue_ordering_rule NOT NULL,
  slot_duration_minutes    INTEGER,
  default_advance_capacity INTEGER             NOT NULL DEFAULT 0,
  default_walkin_capacity  INTEGER             NOT NULL DEFAULT 0,
  effective_from           DATE                NOT NULL,
  effective_to             DATE,
  is_active                BOOLEAN             NOT NULL DEFAULT true,

  CONSTRAINT fk_rar_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id),

  CONSTRAINT ck_rar_day_of_week
    CHECK (day_of_week >= 0 AND day_of_week <= 6),

  CONSTRAINT ck_rar_end_after_start
    CHECK (end_time > start_time),

  CONSTRAINT ck_rar_advance_capacity_nonneg
    CHECK (default_advance_capacity >= 0),

  CONSTRAINT ck_rar_walkin_capacity_nonneg
    CHECK (default_walkin_capacity >= 0),

  CONSTRAINT ck_rar_effective_to
    CHECK (effective_to IS NULL OR effective_to >= effective_from),

  -- TOKEN_SESSION requires BY_TOKEN; TIMED_SESSION requires BY_ARRIVAL
  CONSTRAINT ck_rar_mode_queue_match
    CHECK (
      (session_mode = 'TOKEN_SESSION' AND queue_order = 'BY_TOKEN')
      OR (session_mode = 'TIMED_SESSION' AND queue_order = 'BY_ARRIVAL')
    ),

  -- TIMED_SESSION requires a positive slot_duration_minutes
  CONSTRAINT ck_rar_timed_slot_duration
    CHECK (
      session_mode <> 'TIMED_SESSION'
      OR (slot_duration_minutes IS NOT NULL AND slot_duration_minutes > 0)
    )
);

CREATE INDEX idx_rar_doctor_day ON recurring_availability_rules (doctor_id, day_of_week);

-- ── availability_exceptions ──────────────────────────────────

CREATE TABLE availability_exceptions (
  id             UUID           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id      UUID           NOT NULL,
  exception_date DATE           NOT NULL,
  start_time     TIME,
  end_time       TIME,
  kind           exception_type NOT NULL,
  reason         TEXT,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT fk_ae_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id),

  -- Both times null (full-day) OR both non-null with end > start
  CONSTRAINT ck_ae_times_both_or_neither
    CHECK (
      (start_time IS NULL AND end_time IS NULL)
      OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    )
);

CREATE INDEX idx_availability_exceptions_doctor_date
  ON availability_exceptions (doctor_id, exception_date);

-- ── elastic_sessions ─────────────────────────────────────────

CREATE TABLE elastic_sessions (
  id                    UUID                    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doctor_id             UUID                    NOT NULL,
  source_rule_id        UUID,
  session_date          DATE                    NOT NULL,
  start_time            TIME                    NOT NULL,
  end_time              TIME                    NOT NULL,
  session_mode          scheduling_mode         NOT NULL,
  queue_order           queue_ordering_rule     NOT NULL,
  status                session_lifecycle_status NOT NULL DEFAULT 'SCHEDULED',
  delay_offset_minutes  INTEGER                 NOT NULL DEFAULT 0,
  allow_quota_override  BOOLEAN                 NOT NULL DEFAULT false,
  last_issued_token     INTEGER                 NOT NULL DEFAULT 0,
  version               INTEGER                 NOT NULL DEFAULT 1,
  consulting_ended_at   TIMESTAMPTZ,
  noshow_swept_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ             NOT NULL DEFAULT now(),

  CONSTRAINT fk_es_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE RESTRICT,

  CONSTRAINT fk_es_source_rule
    FOREIGN KEY (source_rule_id) REFERENCES recurring_availability_rules (id) ON DELETE SET NULL,

  CONSTRAINT ck_es_end_after_start
    CHECK (end_time > start_time),

  CONSTRAINT ck_es_delay_nonneg
    CHECK (delay_offset_minutes >= 0),

  CONSTRAINT ck_es_last_issued_token_nonneg
    CHECK (last_issued_token >= 0),

  -- TOKEN_SESSION requires BY_TOKEN; TIMED_SESSION requires BY_ARRIVAL
  CONSTRAINT ck_es_mode_queue_match
    CHECK (
      (session_mode = 'TOKEN_SESSION' AND queue_order = 'BY_TOKEN')
      OR (session_mode = 'TIMED_SESSION' AND queue_order = 'BY_ARRIVAL')
    )
);

-- Composite unique used for FK references
ALTER TABLE elastic_sessions
  ADD CONSTRAINT uq_elastic_sessions_id_doctor_id UNIQUE (id, doctor_id);

-- Partial unique: one generated session per rule per date
CREATE UNIQUE INDEX idx_es_source_rule_date
  ON elastic_sessions (source_rule_id, session_date)
  WHERE source_rule_id IS NOT NULL;

-- Exclusion constraint: no overlapping active sessions for same doctor on same date
-- Uses btree_gist extension. The interval covers the same calendar date.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE elastic_sessions ADD CONSTRAINT excl_es_no_overlap_active
  EXCLUDE USING GIST (
    doctor_id WITH =,
    session_date WITH =,
    tsrange(
      (session_date + start_time)::timestamp,
      (session_date + end_time)::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (status <> 'CANCELLED');

-- ── session_timed_slots ──────────────────────────────────────

CREATE TABLE session_timed_slots (
  id              UUID              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID              NOT NULL,
  slot_start_time TIME              NOT NULL,
  slot_end_time   TIME              NOT NULL,
  status          timed_slot_status NOT NULL DEFAULT 'AVAILABLE',
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT fk_sts_session
    FOREIGN KEY (session_id) REFERENCES elastic_sessions (id),

  CONSTRAINT ck_sts_slot_end_after_start
    CHECK (slot_end_time > slot_start_time),

  CONSTRAINT uq_sts_session_start_time
    UNIQUE (session_id, slot_start_time)
);

-- Composite unique for FK references
ALTER TABLE session_timed_slots
  ADD CONSTRAINT uq_sts_id_session_id UNIQUE (id, session_id);

-- Exclusion constraint: no overlapping timed slots within the same session
ALTER TABLE session_timed_slots ADD CONSTRAINT excl_sts_no_overlap
  EXCLUDE USING GIST (
    session_id WITH =,
    tsrange(
      ('2000-01-01'::date + slot_start_time)::timestamp,
      ('2000-01-01'::date + slot_end_time)::timestamp,
      '[)'
    ) WITH &&
  );

-- ── slot_allocations ─────────────────────────────────────────

CREATE TABLE slot_allocations (
  id            UUID                NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    UUID                NOT NULL,
  timed_slot_id UUID,
  pool_type     allocation_pool_type NOT NULL,
  max_capacity  INTEGER             NOT NULL,
  booked_count  INTEGER             NOT NULL DEFAULT 0,
  version       INTEGER             NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT fk_sa_session
    FOREIGN KEY (session_id) REFERENCES elastic_sessions (id),

  CONSTRAINT fk_sa_timed_slot
    FOREIGN KEY (timed_slot_id) REFERENCES session_timed_slots (id),

  -- Composite FK: ensure the timed slot belongs to the same session
  CONSTRAINT fk_sa_timed_slot_session_composite
    FOREIGN KEY (timed_slot_id, session_id)
    REFERENCES session_timed_slots (id, session_id),

  CONSTRAINT ck_sa_max_capacity
    CHECK (max_capacity >= 0),

  CONSTRAINT ck_sa_booked_count_range
    CHECK (booked_count >= 0 AND booked_count <= max_capacity)
);

-- Composite unique used for appointment FK references
ALTER TABLE slot_allocations
  ADD CONSTRAINT uq_sa_id_session_pool UNIQUE (id, session_id, pool_type);

-- Session-level pools (no timed_slot_id): one pool type per session
CREATE UNIQUE INDEX idx_sa_session_pool_session_level
  ON slot_allocations (session_id, pool_type)
  WHERE timed_slot_id IS NULL;

-- Timed-slot-level pools: one pool type per timed slot
CREATE UNIQUE INDEX idx_sa_timed_slot_pool
  ON slot_allocations (timed_slot_id, pool_type)
  WHERE timed_slot_id IS NOT NULL;

-- ============================================================
-- APPOINTMENT MODULE
-- ============================================================

CREATE TABLE appointments (
  id                           UUID                   NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_reference            VARCHAR(40)            NOT NULL UNIQUE,
  patient_id                   UUID                   NOT NULL,
  doctor_id                    UUID                   NOT NULL,
  session_id                   UUID                   NOT NULL,
  allocation_id                UUID                   NOT NULL,
  timed_slot_id                UUID,
  pool_type                    allocation_pool_type   NOT NULL,
  token_number                 INTEGER,
  visit_kind                   visit_type             NOT NULL,
  channel                      booking_channel_type   NOT NULL,
  status                       appointment_status     NOT NULL DEFAULT 'BOOKED',
  is_emergency_priority        BOOLEAN                NOT NULL DEFAULT false,
  reason_for_visit             TEXT,
  referred_by_name             VARCHAR(160),
  booked_by_user_id            UUID,
  override_authorized_by_user_id UUID,
  override_reason              TEXT,
  checked_in_at                TIMESTAMPTZ,
  consult_started_at           TIMESTAMPTZ,
  completed_at                 TIMESTAMPTZ,
  cancelled_at                 TIMESTAMPTZ,
  cancelled_by_role            cancellation_actor_type,
  cancellation_reason          TEXT,
  created_at                   TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT fk_appt_patient
    FOREIGN KEY (patient_id) REFERENCES patients (id),

  CONSTRAINT fk_appt_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id),

  CONSTRAINT fk_appt_session
    FOREIGN KEY (session_id) REFERENCES elastic_sessions (id),

  CONSTRAINT fk_appt_allocation
    FOREIGN KEY (allocation_id) REFERENCES slot_allocations (id),

  CONSTRAINT fk_appt_timed_slot
    FOREIGN KEY (timed_slot_id) REFERENCES session_timed_slots (id),

  CONSTRAINT fk_appt_booked_by
    FOREIGN KEY (booked_by_user_id) REFERENCES users (id) ON DELETE SET NULL,

  CONSTRAINT fk_appt_override_authorized_by
    FOREIGN KEY (override_authorized_by_user_id) REFERENCES users (id) ON DELETE SET NULL,

  -- Composite FK: session and doctor must be consistent
  CONSTRAINT fk_appt_session_doctor_composite
    FOREIGN KEY (session_id, doctor_id)
    REFERENCES elastic_sessions (id, doctor_id),

  -- Composite FK: allocation must belong to the appointment's session and pool
  CONSTRAINT fk_appt_allocation_session_pool_composite
    FOREIGN KEY (allocation_id, session_id, pool_type)
    REFERENCES slot_allocations (id, session_id, pool_type),

  -- Composite FK: timed slot must belong to the appointment's session
  CONSTRAINT fk_appt_timed_slot_session_composite
    FOREIGN KEY (timed_slot_id, session_id)
    REFERENCES session_timed_slots (id, session_id),

  -- token_number must be null or positive
  CONSTRAINT ck_appt_token_number_positive
    CHECK (token_number IS NULL OR token_number > 0),

  -- WEB_PATIENT and WHATSAPP_BOT may only use ADVANCE_BOOKING
  CONSTRAINT ck_appt_channel_pool_type
    CHECK (
      channel NOT IN ('WEB_PATIENT', 'WHATSAPP_BOT')
      OR pool_type = 'ADVANCE_BOOKING'
    ),

  -- OVERRIDE_OVERFLOW requires RECEPTION_DESK channel, non-null authorizer, non-empty reason
  CONSTRAINT ck_appt_override_overflow_meta
    CHECK (
      pool_type <> 'OVERRIDE_OVERFLOW'
      OR (
        channel = 'RECEPTION_DESK'
        AND override_authorized_by_user_id IS NOT NULL
        AND override_reason IS NOT NULL
        AND trim(override_reason) <> ''
      )
    ),

  -- Non-OVERRIDE_OVERFLOW must NOT have override metadata
  CONSTRAINT ck_appt_no_override_meta_for_non_overflow
    CHECK (
      pool_type = 'OVERRIDE_OVERFLOW'
      OR (override_authorized_by_user_id IS NULL AND override_reason IS NULL)
    ),

  -- Cancelled appointment must have cancellation metadata
  CONSTRAINT ck_appt_cancelled_metadata
    CHECK (
      status <> 'CANCELLED'
      OR (
        cancelled_at IS NOT NULL
        AND cancelled_by_role IS NOT NULL
        AND cancellation_reason IS NOT NULL
        AND trim(cancellation_reason) <> ''
      )
    ),

  -- Non-cancelled must NOT have cancellation metadata
  CONSTRAINT ck_appt_no_cancellation_meta_for_active
    CHECK (
      status = 'CANCELLED'
      OR (cancelled_at IS NULL AND cancelled_by_role IS NULL AND cancellation_reason IS NULL)
    )
);

-- Unique active booking per patient per session (CANCELLED excluded)
CREATE UNIQUE INDEX idx_appt_patient_session_active
  ON appointments (patient_id, session_id)
  WHERE status <> 'CANCELLED';

-- Unique token number per session
CREATE UNIQUE INDEX idx_appt_session_token
  ON appointments (session_id, token_number)
  WHERE token_number IS NOT NULL;

-- Queue ordering index
CREATE INDEX idx_appt_queue
  ON appointments (session_id, status, is_emergency_priority DESC, token_number ASC);

-- Patient history index
CREATE INDEX idx_appt_patient_history
  ON appointments (patient_id, created_at DESC);

-- ── Appointment mode enforcement trigger ─────────────────────
-- TOKEN_SESSION: token_number required, timed_slot_id must be null
-- TIMED_SESSION: timed_slot_id required, token_number must be null

CREATE OR REPLACE FUNCTION trg_appt_mode_check()
RETURNS TRIGGER AS $$
DECLARE
  v_session_mode scheduling_mode;
BEGIN
  SELECT session_mode INTO v_session_mode
  FROM elastic_sessions
  WHERE id = NEW.session_id;

  IF v_session_mode = 'TOKEN_SESSION' THEN
    IF NEW.timed_slot_id IS NOT NULL THEN
      RAISE EXCEPTION
        'TOKEN_SESSION appointment must not reference a timed slot (appointment_id=%, session_id=%)',
        NEW.id, NEW.session_id;
    END IF;
    IF NEW.token_number IS NULL THEN
      RAISE EXCEPTION
        'TOKEN_SESSION appointment must have a token_number (appointment_id=%, session_id=%)',
        NEW.id, NEW.session_id;
    END IF;
  ELSIF v_session_mode = 'TIMED_SESSION' THEN
    IF NEW.timed_slot_id IS NULL THEN
      RAISE EXCEPTION
        'TIMED_SESSION appointment must reference a timed slot (appointment_id=%, session_id=%)',
        NEW.id, NEW.session_id;
    END IF;
    IF NEW.token_number IS NOT NULL THEN
      RAISE EXCEPTION
        'TIMED_SESSION appointment must not have a token_number (appointment_id=%, session_id=%)',
        NEW.id, NEW.session_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appointments_mode_check
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION trg_appt_mode_check();

-- ── reschedule_histories ─────────────────────────────────────

CREATE TABLE reschedule_histories (
  id                       UUID                      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id           UUID                      NOT NULL,
  previous_session_id      UUID                      NOT NULL,
  previous_allocation_id   UUID                      NOT NULL,
  previous_timed_slot_id   UUID,
  previous_pool_type       allocation_pool_type      NOT NULL,
  previous_token_number    INTEGER,
  new_session_id           UUID                      NOT NULL,
  new_allocation_id        UUID                      NOT NULL,
  new_timed_slot_id        UUID,
  new_pool_type            allocation_pool_type      NOT NULL,
  new_token_number         INTEGER,
  rescheduled_by_user_id   UUID,
  initiator_role           reschedule_initiator_type NOT NULL,
  reason                   TEXT,
  rescheduled_at           TIMESTAMPTZ               NOT NULL DEFAULT now(),

  -- appointment_id: ON DELETE RESTRICT keeps history intact
  CONSTRAINT fk_rh_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT,

  CONSTRAINT fk_rh_rescheduled_by
    FOREIGN KEY (rescheduled_by_user_id) REFERENCES users (id) ON DELETE SET NULL,

  -- previous session
  CONSTRAINT fk_rh_previous_session
    FOREIGN KEY (previous_session_id) REFERENCES elastic_sessions (id) ON DELETE RESTRICT,

  -- new session
  CONSTRAINT fk_rh_new_session
    FOREIGN KEY (new_session_id) REFERENCES elastic_sessions (id) ON DELETE RESTRICT,

  -- previous allocation
  CONSTRAINT fk_rh_previous_allocation
    FOREIGN KEY (previous_allocation_id) REFERENCES slot_allocations (id) ON DELETE RESTRICT,

  -- new allocation
  CONSTRAINT fk_rh_new_allocation
    FOREIGN KEY (new_allocation_id) REFERENCES slot_allocations (id) ON DELETE RESTRICT,

  -- previous timed slot
  CONSTRAINT fk_rh_previous_timed_slot
    FOREIGN KEY (previous_timed_slot_id) REFERENCES session_timed_slots (id) ON DELETE RESTRICT,

  -- new timed slot
  CONSTRAINT fk_rh_new_timed_slot
    FOREIGN KEY (new_timed_slot_id) REFERENCES session_timed_slots (id) ON DELETE RESTRICT,

  -- Composite FK: previous allocation must match previous session and pool
  CONSTRAINT fk_rh_prev_alloc_session_pool_composite
    FOREIGN KEY (previous_allocation_id, previous_session_id, previous_pool_type)
    REFERENCES slot_allocations (id, session_id, pool_type),

  -- Composite FK: new allocation must match new session and pool
  CONSTRAINT fk_rh_new_alloc_session_pool_composite
    FOREIGN KEY (new_allocation_id, new_session_id, new_pool_type)
    REFERENCES slot_allocations (id, session_id, pool_type),

  -- Composite FK: previous timed slot must belong to previous session
  CONSTRAINT fk_rh_prev_timed_slot_session_composite
    FOREIGN KEY (previous_timed_slot_id, previous_session_id)
    REFERENCES session_timed_slots (id, session_id),

  -- Composite FK: new timed slot must belong to new session
  CONSTRAINT fk_rh_new_timed_slot_session_composite
    FOREIGN KEY (new_timed_slot_id, new_session_id)
    REFERENCES session_timed_slots (id, session_id)
);

CREATE INDEX idx_rh_appointment_rescheduled_at
  ON reschedule_histories (appointment_id, rescheduled_at DESC);

-- ── Immutability trigger for reschedule_histories ────────────

CREATE OR REPLACE FUNCTION trg_rh_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'reschedule_histories rows are immutable and cannot be updated (id=%)', OLD.id;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'reschedule_histories rows are immutable and cannot be deleted (id=%)', OLD.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reschedule_histories_immutable
  BEFORE UPDATE OR DELETE ON reschedule_histories
  FOR EACH ROW EXECUTE FUNCTION trg_rh_immutable();

-- ── notifications ─────────────────────────────────────────────

CREATE TABLE notifications (
  id                   UUID                          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id       UUID,
  recipient_patient_id UUID,
  recipient_user_id    UUID,
  channel              notification_channel          NOT NULL,
  event_type           notification_event_type       NOT NULL,
  template_code        VARCHAR(64)                   NOT NULL,
  payload_snapshot     JSONB                         NOT NULL DEFAULT '{}',
  status               notification_delivery_status  NOT NULL DEFAULT 'QUEUED',
  idempotency_key      VARCHAR(128)                  NOT NULL UNIQUE,
  failure_reason       TEXT,
  scheduled_for        TIMESTAMPTZ                   NOT NULL,
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  read_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ                   NOT NULL DEFAULT now(),

  CONSTRAINT fk_notif_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,

  CONSTRAINT fk_notif_recipient_patient
    FOREIGN KEY (recipient_patient_id) REFERENCES patients (id) ON DELETE RESTRICT,

  CONSTRAINT fk_notif_recipient_user
    FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON DELETE RESTRICT,

  -- Exactly one recipient must be non-null
  CONSTRAINT ck_notif_one_recipient
    CHECK (
      (recipient_patient_id IS NOT NULL AND recipient_user_id IS NULL)
      OR (recipient_patient_id IS NULL AND recipient_user_id IS NOT NULL)
    ),

  -- read_at is non-null exactly when status = READ
  CONSTRAINT ck_notif_read_at_status
    CHECK (
      (status = 'READ' AND read_at IS NOT NULL)
      OR (status <> 'READ' AND read_at IS NULL)
    )
);

CREATE INDEX idx_notifications_status_scheduled
  ON notifications (status, scheduled_for);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
-- Application-level invariants (not enforced by SQL alone):
--
-- 1. OVERRIDE_OVERFLOW authorizer must hold ADMIN or RECEPTIONIST role.
--    Verified in the booking service before insert.
--
-- 2. Booking and rescheduling operations must use explicit database
--    transactions. slot_allocations rows must be locked with
--    SELECT ... FOR UPDATE ordered by allocation UUID to prevent deadlock.
--
-- 3. booked_count is the single authoritative capacity counter.
--    It is incremented on booking and decremented only on transition
--    to CANCELLED; double-decrement is guarded at the service layer.
--
-- 4. Rescheduling: appointment update and reschedule_history insert
--    must occur in the same transaction. Both old and new allocations
--    are locked in UUID order.
--
-- 5. Verification tokens: the service must HMAC the token with a
--    server-side secret, enforce single use and expiration, and
--    rate-limit failed attempts via attempt_count.
-- ============================================================
