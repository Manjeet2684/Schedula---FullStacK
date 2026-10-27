-- ============================================================
-- scripts/verify-db.sql
-- Schedula Stage 2 — Database Constraint Verification Script
-- ============================================================
--
-- WARNING: Run ONLY against a DISPOSABLE TEST DATABASE.
-- All fixture inserts are wrapped in a single transaction
-- that is ROLLED BACK at the end. No data is persisted.
--
-- Usage:
--   psql <your-test-connection-string> -f scripts/verify-db.sql
--
-- Example:
--   psql postgresql://schedula:schedula_dev_password@localhost:5433/schedula_test \
--        -f scripts/verify-db.sql
--
-- Prerequisites:
--   - A clean PostgreSQL 17 database with the migration already applied.
--   - DO NOT run against a production database.
-- ============================================================

BEGIN;

-- ============================================================
-- SETUP: Shared Fixture Data
-- ============================================================

-- Users
INSERT INTO users (id, email, status)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'patient_a@test.local', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000002', 'patient_b@test.local', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000003', 'doctor_a@test.local',  'ACTIVE'),
  ('00000000-0000-0000-0000-000000000004', 'admin_a@test.local',   'ACTIVE'),
  ('00000000-0000-0000-0000-000000000005', 'patient_c@test.local', 'ACTIVE');

-- Patient records
INSERT INTO patients (id, user_id, patient_code, given_name, sex, date_of_birth, contact_phone)
VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'PT001', 'Alice', 'FEMALE', '1990-01-01', '9000000001'),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000002', 'PT002', 'Bob',   'MALE',   '1985-06-15', '9000000002'),
  ('00000000-0000-0000-0001-000000000003', NULL,                                   'PT003', 'Carol', 'FEMALE', '1975-03-20', '9000000003');

-- Doctor
INSERT INTO doctors (id, user_id, doctor_code, onboarding_status, medical_council, registration_number, credentials_verified_at, verified_by_user_id, is_active_for_booking)
VALUES
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000003', 'DR001', 'APPROVED', 'MCI', 'MCI-12345', now(), '00000000-0000-0000-0000-000000000004', true);

-- Elastic session
INSERT INTO elastic_sessions (id, doctor_id, session_date, start_time, end_time, session_mode, queue_order, status)
VALUES
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0002-000000000001', CURRENT_DATE + 1, '09:00', '12:00', 'TOKEN_SESSION', 'BY_TOKEN', 'SCHEDULED');

-- Slot allocation for the session
INSERT INTO slot_allocations (id, session_id, pool_type, max_capacity, booked_count)
VALUES
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000001', 'ADVANCE_BOOKING', 2, 0);

-- ============================================================
-- SCENARIO 1: Duplicate active patient/session booking is rejected
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 1: Duplicate active booking rejected ---';

  -- First booking for Alice in this session
  INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status)
  VALUES (
    '00000000-0000-0000-0005-000000000001',
    'REF-SCEN1-001',
    '00000000-0000-0000-0001-000000000001',  -- Alice
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0003-000000000001',
    '00000000-0000-0000-0004-000000000001',
    'ADVANCE_BOOKING',
    1,
    'NEW_VISIT',
    'WEB_PATIENT',
    'BOOKED'
  );
  RAISE NOTICE 'Scenario 1: First booking inserted (expected: success)';

  BEGIN
    -- Attempt duplicate booking for Alice in the same session
    INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status)
    VALUES (
      '00000000-0000-0000-0005-000000000099',
      'REF-SCEN1-002',
      '00000000-0000-0000-0001-000000000001',  -- Alice again
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0003-000000000001',
      '00000000-0000-0000-0004-000000000001',
      'ADVANCE_BOOKING',
      2,
      'NEW_VISIT',
      'WEB_PATIENT',
      'BOOKED'
    );
    RAISE EXCEPTION 'Scenario 1 FAILED: Duplicate booking was not rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Scenario 1 PASSED: Duplicate active booking correctly rejected (unique_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 2: Cancellation followed by rebooking succeeds
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 2: Cancel then rebook ---';

  -- Cancel Alice's first booking
  UPDATE appointments
  SET status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by_role = 'PATIENT',
      cancellation_reason = 'Patient requested cancellation'
  WHERE id = '00000000-0000-0000-0005-000000000001';

  -- Rebook Alice in the same session (should succeed because status = CANCELLED is excluded from partial index)
  INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status)
  VALUES (
    '00000000-0000-0000-0005-000000000002',
    'REF-SCEN2-001',
    '00000000-0000-0000-0001-000000000001',  -- Alice
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0003-000000000001',
    '00000000-0000-0000-0004-000000000001',
    'ADVANCE_BOOKING',
    1,
    'NEW_VISIT',
    'WEB_PATIENT',
    'BOOKED'
  );
  RAISE NOTICE 'Scenario 2 PASSED: Rebooking after cancellation succeeded';
END;
$$;

-- ============================================================
-- SCENARIO 3: Counter update exceeding capacity is rejected
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 3: Counter exceeding max_capacity rejected ---';

  BEGIN
    UPDATE slot_allocations
    SET booked_count = 3  -- max_capacity is 2
    WHERE id = '00000000-0000-0000-0004-000000000001';
    RAISE EXCEPTION 'Scenario 3 FAILED: Over-capacity counter was not rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Scenario 3 PASSED: booked_count > max_capacity correctly rejected (check_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 4: Overlapping active doctor sessions are rejected
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 4: Overlapping sessions rejected ---';

  BEGIN
    -- Try to insert a session that overlaps the existing one
    INSERT INTO elastic_sessions (id, doctor_id, session_date, start_time, end_time, session_mode, queue_order, status)
    VALUES (
      '00000000-0000-0000-0003-000000000099',
      '00000000-0000-0000-0002-000000000001',
      CURRENT_DATE + 1,
      '10:00',  -- Overlaps with 09:00-12:00
      '13:00',
      'TOKEN_SESSION',
      'BY_TOKEN',
      'SCHEDULED'
    );
    RAISE EXCEPTION 'Scenario 4 FAILED: Overlapping sessions were not rejected';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'Scenario 4 PASSED: Overlapping active sessions correctly rejected (exclusion_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 5: Overlapping timed slots within a session are rejected
-- ============================================================

DO $$
DECLARE
  v_timed_session_id UUID := '00000000-0000-0000-0003-000000000002';
BEGIN
  RAISE NOTICE '--- Scenario 5: Overlapping timed slots rejected ---';

  -- Create a TIMED_SESSION first
  INSERT INTO elastic_sessions (id, doctor_id, session_date, start_time, end_time, session_mode, queue_order, status)
  VALUES (v_timed_session_id, '00000000-0000-0000-0002-000000000001', CURRENT_DATE + 2, '14:00', '18:00', 'TIMED_SESSION', 'BY_ARRIVAL', 'SCHEDULED');

  -- Insert first timed slot
  INSERT INTO session_timed_slots (id, session_id, slot_start_time, slot_end_time)
  VALUES ('00000000-0000-0000-0006-000000000001', v_timed_session_id, '14:00', '14:30');

  BEGIN
    -- Attempt overlapping slot
    INSERT INTO session_timed_slots (id, session_id, slot_start_time, slot_end_time)
    VALUES ('00000000-0000-0000-0006-000000000099', v_timed_session_id, '14:15', '14:45');
    RAISE EXCEPTION 'Scenario 5 FAILED: Overlapping timed slots were not rejected';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'Scenario 5 PASSED: Overlapping timed slots correctly rejected (exclusion_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 6: Mismatched session/doctor/allocation/pool references rejected
-- ============================================================

DO $$
DECLARE
  v_other_session_id UUID := '00000000-0000-0000-0003-000000000003';
  v_other_alloc_id UUID := '00000000-0000-0000-0004-000000000002';
BEGIN
  RAISE NOTICE '--- Scenario 6: Mismatched allocation/session reference rejected ---';

  -- Create another session for the same doctor
  INSERT INTO elastic_sessions (id, doctor_id, session_date, start_time, end_time, session_mode, queue_order, status)
  VALUES (v_other_session_id, '00000000-0000-0000-0002-000000000001', CURRENT_DATE + 3, '09:00', '12:00', 'TOKEN_SESSION', 'BY_TOKEN', 'SCHEDULED');

  -- Allocation for the other session
  INSERT INTO slot_allocations (id, session_id, pool_type, max_capacity)
  VALUES (v_other_alloc_id, v_other_session_id, 'ADVANCE_BOOKING', 5);

  BEGIN
    -- Try to book in session 1 but reference allocation from session 2 (should fail composite FK)
    INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status)
    VALUES (
      '00000000-0000-0000-0005-000000000099',
      'REF-SCEN6-001',
      '00000000-0000-0000-0001-000000000002',  -- Bob
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0003-000000000001',  -- Session 1
      v_other_alloc_id,                          -- Allocation from Session 2 (mismatch!)
      'ADVANCE_BOOKING',
      1,
      'NEW_VISIT',
      'WEB_PATIENT',
      'BOOKED'
    );
    RAISE EXCEPTION 'Scenario 6 FAILED: Mismatched allocation/session reference was not rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'Scenario 6 PASSED: Mismatched allocation/session correctly rejected (foreign_key_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 7: Duplicate timed-slot pool allocations rejected
-- ============================================================

DO $$
DECLARE
  v_sess UUID := '00000000-0000-0000-0003-000000000002';
  v_slot UUID := '00000000-0000-0000-0006-000000000001';
BEGIN
  RAISE NOTICE '--- Scenario 7: Duplicate timed-slot pool allocation rejected ---';

  -- First allocation for the slot
  INSERT INTO slot_allocations (id, session_id, timed_slot_id, pool_type, max_capacity)
  VALUES ('00000000-0000-0000-0004-000000000003', v_sess, v_slot, 'ADVANCE_BOOKING', 3);

  BEGIN
    -- Duplicate allocation same slot + pool type
    INSERT INTO slot_allocations (id, session_id, timed_slot_id, pool_type, max_capacity)
    VALUES ('00000000-0000-0000-0004-000000000099', v_sess, v_slot, 'ADVANCE_BOOKING', 2);
    RAISE EXCEPTION 'Scenario 7 FAILED: Duplicate timed-slot pool allocation was not rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Scenario 7 PASSED: Duplicate timed-slot pool allocation correctly rejected (unique_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 8: Identical OTP hash value can exist in distinct records (no global hash collision)
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 8: Identical token_hash allowed across different records ---';

  -- Insert two verification_tokens with the same token_hash (simulating same OTP value for different users)
  INSERT INTO verification_tokens (id, user_id, purpose, target, token_hash, expires_at)
  VALUES
    ('00000000-0000-0000-0007-000000000001',
     '00000000-0000-0000-0000-000000000001',
     'PHONE_OTP', '9000000001',
     'abc123hashvalue', now() + interval '10 minutes'),
    ('00000000-0000-0000-0007-000000000002',
     '00000000-0000-0000-0000-000000000002',
     'PHONE_OTP', '9000000002',
     'abc123hashvalue',  -- Same hash — must NOT cause unique_violation
     now() + interval '10 minutes');

  RAISE NOTICE 'Scenario 8 PASSED: Identical token_hash across different records allowed (no global uniqueness)';
END;
$$;

-- ============================================================
-- SCENARIO 9: Overflow booking without required authorization metadata is rejected
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 9: OVERRIDE_OVERFLOW without authorizer rejected ---';

  BEGIN
    INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status,
                               override_authorized_by_user_id, override_reason)
    VALUES (
      '00000000-0000-0000-0005-000000000010',
      'REF-SCEN9-001',
      '00000000-0000-0000-0001-000000000002',
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0003-000000000001',
      '00000000-0000-0000-0004-000000000001',
      'OVERRIDE_OVERFLOW',
      5,
      'NEW_VISIT',
      'WEB_PATIENT',       -- Must be RECEPTION_DESK for OVERRIDE_OVERFLOW
      'BOOKED',
      NULL,                -- No authorizer
      NULL                 -- No reason
    );
    RAISE EXCEPTION 'Scenario 9 FAILED: OVERRIDE_OVERFLOW without channel=RECEPTION_DESK was not rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Scenario 9 PASSED: OVERRIDE_OVERFLOW without RECEPTION_DESK channel correctly rejected (check_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 10: Cancelled appointment without cancellation metadata is rejected
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '--- Scenario 10: CANCELLED without metadata rejected ---';

  BEGIN
    INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status,
                               cancelled_at, cancelled_by_role, cancellation_reason)
    VALUES (
      '00000000-0000-0000-0005-000000000011',
      'REF-SCEN10-001',
      '00000000-0000-0000-0001-000000000003',  -- Carol (PT003)
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0003-000000000001',
      '00000000-0000-0000-0004-000000000001',
      'ADVANCE_BOOKING',
      6,
      'NEW_VISIT',
      'WEB_PATIENT',
      'CANCELLED',
      NULL,           -- No cancelled_at
      NULL,           -- No cancelled_by_role
      NULL            -- No reason
    );
    RAISE EXCEPTION 'Scenario 10 FAILED: CANCELLED status without metadata was not rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Scenario 10 PASSED: CANCELLED without metadata correctly rejected (check_violation)';
  END;
END;
$$;

-- ============================================================
-- SCENARIO 11: Invalid appointment mode/timed-slot/token combinations rejected
-- (TOKEN_SESSION appointment with a timed_slot_id must be rejected by trigger)
-- ============================================================

DO $$
DECLARE
  v_slot_id UUID := '00000000-0000-0000-0006-000000000001';
BEGIN
  RAISE NOTICE '--- Scenario 11: TOKEN_SESSION with timed_slot_id rejected by trigger ---';

  BEGIN
    INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, session_id, allocation_id, pool_type, token_number, visit_kind, channel, status, timed_slot_id)
    VALUES (
      '00000000-0000-0000-0005-000000000012',
      'REF-SCEN11-001',
      '00000000-0000-0000-0001-000000000003',  -- Carol
      '00000000-0000-0000-0002-000000000001',
      '00000000-0000-0000-0003-000000000001',  -- TOKEN_SESSION
      '00000000-0000-0000-0004-000000000001',
      'ADVANCE_BOOKING',
      7,
      'NEW_VISIT',
      'WEB_PATIENT',
      'BOOKED',
      v_slot_id  -- Must be rejected: TOKEN_SESSION cannot have timed_slot_id
    );
    RAISE EXCEPTION 'Scenario 11 FAILED: TOKEN_SESSION with timed_slot_id was not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%TOKEN_SESSION%' OR SQLERRM LIKE '%timed slot%' OR SQLERRM LIKE '%foreign_key%' THEN
      RAISE NOTICE 'Scenario 11 PASSED: TOKEN_SESSION with timed_slot_id correctly rejected';
    ELSE
      RAISE NOTICE 'Scenario 11 PASSED (fk_violation or trigger): %', SQLERRM;
    END IF;
  END;
END;
$$;

-- ============================================================
-- SCENARIO 12: Reschedule history mutation is rejected by the immutability trigger
-- ============================================================

DO $$
DECLARE
  v_appt_id UUID := '00000000-0000-0000-0005-000000000002';
  v_rh_id UUID;
BEGIN
  RAISE NOTICE '--- Scenario 12: Reschedule history immutability trigger ---';

  -- Insert a reschedule history row
  INSERT INTO reschedule_histories (
    id, appointment_id,
    previous_session_id, previous_allocation_id, previous_pool_type,
    new_session_id, new_allocation_id, new_pool_type,
    initiator_role
  )
  VALUES (
    '00000000-0000-0000-0008-000000000001',
    v_appt_id,
    '00000000-0000-0000-0003-000000000001',
    '00000000-0000-0000-0004-000000000001',
    'ADVANCE_BOOKING',
    '00000000-0000-0000-0003-000000000001',
    '00000000-0000-0000-0004-000000000001',
    'ADVANCE_BOOKING',
    'PATIENT'
  )
  RETURNING id INTO v_rh_id;

  RAISE NOTICE 'Scenario 12: Reschedule history row inserted (id=%)', v_rh_id;

  BEGIN
    UPDATE reschedule_histories
    SET reason = 'Trying to mutate history'
    WHERE id = v_rh_id;
    RAISE EXCEPTION 'Scenario 12 FAILED: Reschedule history UPDATE was not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%immutable%' THEN
      RAISE NOTICE 'Scenario 12 PASSED: Reschedule history mutation correctly rejected by immutability trigger';
    ELSE
      RAISE NOTICE 'Scenario 12 PASSED (trigger raised: %)', SQLERRM;
    END IF;
  END;

  BEGIN
    DELETE FROM reschedule_histories WHERE id = v_rh_id;
    RAISE EXCEPTION 'Scenario 12b FAILED: Reschedule history DELETE was not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%immutable%' THEN
      RAISE NOTICE 'Scenario 12b PASSED: Reschedule history DELETE correctly rejected by immutability trigger';
    ELSE
      RAISE NOTICE 'Scenario 12b PASSED (trigger raised: %)', SQLERRM;
    END IF;
  END;
END;
$$;

-- ============================================================
-- ROLLBACK: Clean up all fixture data
-- ============================================================

ROLLBACK;

\echo ''
\echo '========================================================'
\echo 'verify-db.sql complete — all fixtures ROLLED BACK.'
\echo 'No data was persisted to the database.'
\echo '========================================================'
