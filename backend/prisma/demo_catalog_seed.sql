-- Schedula demo doctor catalogue and appointment availability
-- Safe to run more than once. Creates fictional demo doctor profiles and
-- 21 days of timed appointment slots. Does not delete existing users/bookings.
-- Run from the repository root with:
-- Get-Content .\backend\prisma\demo_catalog_seed.sql -Raw | docker compose exec -T postgres psql -U schedula -d schedula

BEGIN;
SET LOCAL TIME ZONE 'Asia/Kolkata';

CREATE TEMP TABLE demo_specialization_seed (
  code varchar(32) PRIMARY KEY,
  name varchar(120) NOT NULL,
  description text
) ON COMMIT DROP;

INSERT INTO demo_specialization_seed (code, name, description) VALUES
('DERM', 'Dermatology', 'Skin, hair and nail care'),
('ONCO', 'Medical Oncology', 'Cancer diagnosis and medical treatment planning'),
('RAD', 'Radiology & Imaging', 'Diagnostic imaging and scan consultations'),
('ENT', 'ENT (Otolaryngology)', 'Ear, nose and throat care'),
('NEURO', 'Neurology', 'Brain, spine and nervous-system care'),
('NEPH', 'Nephrology', 'Kidney and renal health'),
('CARD', 'Cardiology', 'Heart and cardiovascular care'),
('ORTHO', 'Orthopedics', 'Bone, joint and musculoskeletal care'),
('PEDIA', 'Pediatrics', 'Medical care for infants, children and adolescents'),
('OBGYN', 'Obstetrics & Gynecology', 'Women’s reproductive health, pregnancy and gynecological care');

INSERT INTO specializations (id, code, name, description, is_active)
SELECT md5('schedula-demo-specialization:' || code)::uuid, code, name, description, true
FROM demo_specialization_seed
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

-- A synthetic approver satisfies the database rule that approved doctors
-- must have a verifier. This account has no password and cannot sign in.
INSERT INTO users (id, email, status, is_email_verified)
VALUES (
  md5('schedula-demo-approver')::uuid,
  'demo-approver@schedula.test',
  'ACTIVE',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role)
VALUES (md5('schedula-demo-approver')::uuid, 'ADMIN')
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TEMP TABLE demo_doctor_seed ON COMMIT DROP AS
SELECT
  seed.*,
  md5('schedula-demo-user:' || seed.email)::uuid AS user_id,
  md5('schedula-demo-doctor:' || seed.doctor_code)::uuid AS doctor_id,
  md5('schedula-demo-profile:' || seed.doctor_code)::uuid AS profile_id
FROM (VALUES
  ('DERM', 'DEMO-DERM-01', 'Dr. Aanya Mehta', 'dr.aanya.mehta@demo.schedula.test', 'DEMO-DERM-01', 'MBBS, MD (Dermatology)', 9, 90000, 55000, '09:00'::time, '12:00'::time),
  ('DERM', 'DEMO-DERM-02', 'Dr. Rohan Sethi', 'dr.rohan.sethi@demo.schedula.test', 'DEMO-DERM-02', 'MBBS, DVD', 7, 80000, 50000, '13:00'::time, '16:00'::time),
  ('DERM', 'DEMO-DERM-03', 'Dr. Kavya Nair', 'dr.kavya.nair@demo.schedula.test', 'DEMO-DERM-03', 'MBBS, MD (Dermatology)', 12, 110000, 65000, '17:00'::time, '20:00'::time),

  ('ONCO', 'DEMO-ONCO-01', 'Dr. Arjun Rao', 'dr.arjun.rao@demo.schedula.test', 'DEMO-ONCO-01', 'MBBS, MD, DM (Medical Oncology)', 14, 140000, 90000, '09:00'::time, '12:00'::time),
  ('ONCO', 'DEMO-ONCO-02', 'Dr. Nisha Bansal', 'dr.nisha.bansal@demo.schedula.test', 'DEMO-ONCO-02', 'MBBS, MD (Radiation Oncology)', 10, 120000, 80000, '13:00'::time, '16:00'::time),
  ('ONCO', 'DEMO-ONCO-03', 'Dr. Vikram Iyer', 'dr.vikram.iyer@demo.schedula.test', 'DEMO-ONCO-03', 'MBBS, MD, DM (Medical Oncology)', 16, 150000, 95000, '17:00'::time, '20:00'::time),

  ('RAD', 'DEMO-RAD-01', 'Dr. Neha Khanna', 'dr.neha.khanna@demo.schedula.test', 'DEMO-RAD-01', 'MBBS, MD (Radiodiagnosis)', 11, 75000, 50000, '09:00'::time, '12:00'::time),
  ('RAD', 'DEMO-RAD-02', 'Dr. Aditya Menon', 'dr.aditya.menon@demo.schedula.test', 'DEMO-RAD-02', 'MBBS, DNB (Radiology)', 8, 70000, 45000, '13:00'::time, '16:00'::time),
  ('RAD', 'DEMO-RAD-03', 'Dr. Isha Kapoor', 'dr.isha.kapoor@demo.schedula.test', 'DEMO-RAD-03', 'MBBS, MD (Radiodiagnosis)', 13, 85000, 55000, '17:00'::time, '20:00'::time),

  ('ENT', 'DEMO-ENT-01', 'Dr. Sameer Kapoor', 'dr.sameer.kapoor@demo.schedula.test', 'DEMO-ENT-01', 'MBBS, MS (ENT)', 12, 85000, 55000, '09:00'::time, '12:00'::time),
  ('ENT', 'DEMO-ENT-02', 'Dr. Pooja Menon', 'dr.pooja.menon@demo.schedula.test', 'DEMO-ENT-02', 'MBBS, DNB (Otolaryngology)', 8, 75000, 50000, '13:00'::time, '16:00'::time),
  ('ENT', 'DEMO-ENT-03', 'Dr. Rahul Chawla', 'dr.rahul.chawla@demo.schedula.test', 'DEMO-ENT-03', 'MBBS, MS (ENT)', 15, 95000, 60000, '17:00'::time, '20:00'::time),

  ('NEURO', 'DEMO-NEURO-01', 'Dr. Meera Iyer', 'dr.meera.iyer@demo.schedula.test', 'DEMO-NEURO-01', 'MBBS, MD, DM (Neurology)', 13, 120000, 80000, '09:00'::time, '12:00'::time),
  ('NEURO', 'DEMO-NEURO-02', 'Dr. Kunal Verma', 'dr.kunal.verma@demo.schedula.test', 'DEMO-NEURO-02', 'MBBS, MD (Medicine), DM (Neurology)', 9, 100000, 65000, '13:00'::time, '16:00'::time),
  ('NEURO', 'DEMO-NEURO-03', 'Dr. Sara Thomas', 'dr.sara.thomas@demo.schedula.test', 'DEMO-NEURO-03', 'MBBS, MD, DM (Neurology)', 17, 135000, 90000, '17:00'::time, '20:00'::time),

  ('NEPH', 'DEMO-NEPH-01', 'Dr. Dev Malhotra', 'dr.dev.malhotra@demo.schedula.test', 'DEMO-NEPH-01', 'MBBS, MD, DM (Nephrology)', 15, 110000, 75000, '09:00'::time, '12:00'::time),
  ('NEPH', 'DEMO-NEPH-02', 'Dr. Ananya Bose', 'dr.ananya.bose@demo.schedula.test', 'DEMO-NEPH-02', 'MBBS, MD (Medicine), DM (Nephrology)', 10, 95000, 65000, '13:00'::time, '16:00'::time),
  ('NEPH', 'DEMO-NEPH-03', 'Dr. Farhan Ali', 'dr.farhan.ali@demo.schedula.test', 'DEMO-NEPH-03', 'MBBS, MD, DM (Nephrology)', 18, 125000, 85000, '17:00'::time, '20:00'::time),

  ('CARD', 'DEMO-CARD-01', 'Dr. Ishita Sen', 'dr.ishita.sen@demo.schedula.test', 'DEMO-CARD-01', 'MBBS, MD, DM (Cardiology)', 14, 120000, 80000, '09:00'::time, '12:00'::time),
  ('CARD', 'DEMO-CARD-02', 'Dr. Manav Joshi', 'dr.manav.joshi@demo.schedula.test', 'DEMO-CARD-02', 'MBBS, MD (Medicine), DM (Cardiology)', 9, 100000, 65000, '13:00'::time, '16:00'::time),
  ('CARD', 'DEMO-CARD-03', 'Dr. Ritu Sood', 'dr.ritu.sood@demo.schedula.test', 'DEMO-CARD-03', 'MBBS, MD, DM (Cardiology)', 19, 145000, 95000, '17:00'::time, '20:00'::time),

  ('ORTHO', 'DEMO-ORTHO-01', 'Dr. Kabir Malhotra', 'dr.kabir.malhotra@demo.schedula.test', 'DEMO-ORTHO-01', 'MBBS, MS (Orthopedics)', 12, 95000, 60000, '09:00'::time, '12:00'::time),
  ('ORTHO', 'DEMO-ORTHO-02', 'Dr. Tanya Desai', 'dr.tanya.desai@demo.schedula.test', 'DEMO-ORTHO-02', 'MBBS, DNB (Orthopedics)', 8, 85000, 55000, '13:00'::time, '16:00'::time),
  ('ORTHO', 'DEMO-ORTHO-03', 'Dr. Pranav Ghosh', 'dr.pranav.ghosh@demo.schedula.test', 'DEMO-ORTHO-03', 'MBBS, MS (Orthopedics)', 16, 105000, 70000, '17:00'::time, '20:00'::time),

  ('PEDIA', 'DEMO-PEDIA-01', 'Dr. Diya Nambiar', 'dr.diya.nambiar@demo.schedula.test', 'DEMO-PEDIA-01', 'MBBS, MD (Pediatrics)', 10, 80000, 50000, '09:00'::time, '12:00'::time),
  ('PEDIA', 'DEMO-PEDIA-02', 'Dr. Aarav Kulkarni', 'dr.aarav.kulkarni@demo.schedula.test', 'DEMO-PEDIA-02', 'MBBS, DCH, DNB (Pediatrics)', 7, 70000, 45000, '13:00'::time, '16:00'::time),
  ('PEDIA', 'DEMO-PEDIA-03', 'Dr. Leena George', 'dr.leena.george@demo.schedula.test', 'DEMO-PEDIA-03', 'MBBS, MD (Pediatrics)', 15, 90000, 60000, '17:00'::time, '20:00'::time),

  ('OBGYN', 'DEMO-OBGYN-01', 'Dr. Anika Pillai', 'dr.anika.pillai@demo.schedula.test', 'DEMO-OBGYN-01', 'MBBS, MS (Obstetrics & Gynecology)', 13, 95000, 65000, '09:00'::time, '12:00'::time),
  ('OBGYN', 'DEMO-OBGYN-02', 'Dr. Nitin Arora', 'dr.nitin.arora@demo.schedula.test', 'DEMO-OBGYN-02', 'MBBS, DNB (Obstetrics & Gynecology)', 8, 85000, 55000, '13:00'::time, '16:00'::time),
  ('OBGYN', 'DEMO-OBGYN-03', 'Dr. Sanya Roy', 'dr.sanya.roy@demo.schedula.test', 'DEMO-OBGYN-03', 'MBBS, MS (Obstetrics & Gynecology)', 17, 110000, 75000, '17:00'::time, '20:00'::time)
) AS seed(
  specialization_code, doctor_code, display_name, email, registration_number,
  qualifications, years_of_experience, new_fee_minor, follow_up_fee_minor,
  shift_start, shift_end
);

INSERT INTO users (id, email, status, is_email_verified)
SELECT user_id, email, 'ACTIVE', true
FROM demo_doctor_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role)
SELECT user_id, 'DOCTOR'
FROM demo_doctor_seed
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO doctors (
  id, user_id, doctor_code, onboarding_status, medical_council,
  registration_number, credentials_verified_at, verified_by_user_id,
  is_active_for_booking
)
SELECT
  doctor_id, user_id, doctor_code, 'APPROVED', 'DEMO',
  registration_number, now(), md5('schedula-demo-approver')::uuid, true
FROM demo_doctor_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO doctor_profiles (
  id, doctor_id, display_name, qualifications, bio, years_of_experience,
  new_visit_fee_minor, follow_up_fee_minor, fee_currency, updated_at
)
SELECT
  profile_id, doctor_id, display_name, qualifications,
  'Demo profile for Schedula booking-flow testing. Fictional sample data, not a real clinician.',
  years_of_experience, new_fee_minor, follow_up_fee_minor, 'INR', now()
FROM demo_doctor_seed
ON CONFLICT (doctor_id) DO NOTHING;

INSERT INTO doctor_specializations (doctor_id, specialization_id, is_primary)
SELECT d.doctor_id, s.id, true
FROM demo_doctor_seed d
JOIN specializations s ON s.code = d.specialization_code
ON CONFLICT (doctor_id, specialization_id) DO NOTHING;

-- Give every demo doctor a three-hour timed clinic session on each of the
-- next 21 calendar days. Each session has six 30-minute advance slots.
-- Shifts are staggered: morning 09:00–12:00, afternoon 13:00–16:00,
-- and evening 17:00–20:00.
INSERT INTO elastic_sessions (
  id, doctor_id, session_date, start_time, end_time, session_mode,
  queue_order, status, created_at, updated_at
)
SELECT
  md5('schedula-demo-session:' || d.doctor_code || ':' || (CURRENT_DATE + day.day_offset)::text)::uuid,
  d.doctor_id,
  CURRENT_DATE + day.day_offset,
  d.shift_start,
  d.shift_end,
  'TIMED_SESSION',
  'BY_ARRIVAL',
  'SCHEDULED',
  now(),
  now()
FROM demo_doctor_seed d
CROSS JOIN generate_series(0, 20) AS day(day_offset)
ON CONFLICT (id) DO NOTHING;

INSERT INTO session_timed_slots (
  id, session_id, slot_start_time, slot_end_time, status, created_at
)
SELECT
  md5('schedula-demo-slot:' || session.id::text || ':' || slot.slot_number::text)::uuid,
  session.id,
  session.start_time + (slot.slot_number * interval '30 minutes'),
  session.start_time + ((slot.slot_number + 1) * interval '30 minutes'),
  'AVAILABLE',
  now()
FROM elastic_sessions session
JOIN demo_doctor_seed doctor ON doctor.doctor_id = session.doctor_id
CROSS JOIN generate_series(0, 5) AS slot(slot_number)
WHERE session.session_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 20
ON CONFLICT (session_id, slot_start_time) DO NOTHING;

INSERT INTO slot_allocations (
  id, session_id, timed_slot_id, pool_type, max_capacity,
  booked_count, version, updated_at
)
SELECT
  md5('schedula-demo-allocation:' || timed_slot.id::text || ':' || pool.pool_type::text)::uuid,
  timed_slot.session_id,
  timed_slot.id,
  pool.pool_type,
  pool.max_capacity,
  0,
  1,
  now()
FROM session_timed_slots timed_slot
JOIN elastic_sessions session ON session.id = timed_slot.session_id
JOIN demo_doctor_seed doctor ON doctor.doctor_id = session.doctor_id
CROSS JOIN (VALUES
  ('ADVANCE_BOOKING'::allocation_pool_type, 2),
  ('WALK_IN_RESERVE'::allocation_pool_type, 1)
) AS pool(pool_type, max_capacity)
WHERE session.session_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 20
ON CONFLICT (id) DO NOTHING;

COMMIT;
