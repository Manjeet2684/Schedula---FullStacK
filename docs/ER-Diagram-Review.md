# Schedula — ER Diagram Review, Design Decisions, and Transaction Invariants

**Stage 2 Foundation — PearlThoughts Full-Stack Developer Internship**

---

## 1. Agreed Design Decisions

### Decision 1 — Retain 17-table, 5-module schema
The schema consists of exactly 17 tables across five modules: User (4), Patient (1), Doctor (4), Availability (5), Appointment (3). No additional tables are added in Stage 2.

### Decision 2 — Many-to-many doctor/specialization junction
`doctor_specializations` is a many-to-many junction table supporting multiple specializations per doctor. A partial unique index enforces at most one primary specialization per doctor:
```sql
CREATE UNIQUE INDEX idx_doctor_specializations_one_primary
  ON doctor_specializations (doctor_id)
  WHERE is_primary = true;
```

### Decision 3 — Nullable unique `patients.user_id`
`patients.user_id` is nullable and unique. Reception desk staff can create patient records without requiring the patient to have a login account. A `UNIQUE` constraint on the column ensures no two patients map to the same user.

### Decision 4 — Contact phone indexed but not unique
`patients.contact_phone` is indexed for lookup performance but is **not** unique. Family members may share a guardian's phone number.

### Decision 5 — Single-clinic scope
No facilities/branches table is required. Multi-clinic and multi-tenant support is explicitly out of scope for Stage 2.

### Decision 6 — Stage 2 exclusions
Billing, consultation fees, free-follow-up pricing rules, EMR/vitals, prescriptions, clinical notes, Cashfree integration, multi-tenant administration, break-glass access, and platform-admin expansion are all excluded from Stage 2.

### Decision 7 — Token sessions and timed sessions as separate scheduling modes
A TOKEN_SESSION has no `session_timed_slots` row. A TIMED_SESSION appointment references an actual `session_timed_slots` row. A PostgreSQL trigger on `appointments` enforces this separation:
```sql
-- TOKEN_SESSION: timed_slot_id must be NULL, token_number must NOT be NULL
-- TIMED_SESSION: timed_slot_id must NOT be NULL, token_number must be NULL
```

### Decision 8 — Single authoritative capacity counter
`slot_allocations.booked_count` is the **only** stored capacity counter. `session_timed_slots` has no `booked_count`, `max_patients`, or `FULL` status column. A `FULL` slot status is explicitly omitted because fullness is derived from the allocation pool's authoritative counter.

### Decision 9 — Pool allocation identity
A pool allocation is identified by session, optional timed slot, and pool type. A timed slot may have distinct ADVANCE_BOOKING and WALK_IN_RESERVE pools. Partial unique indexes enforce this:
```sql
-- Session-level pool (no timed slot)
CREATE UNIQUE INDEX idx_sa_session_pool_session_level
  ON slot_allocations (session_id, pool_type) WHERE timed_slot_id IS NULL;

-- Timed-slot-level pool
CREATE UNIQUE INDEX idx_sa_timed_slot_pool
  ON slot_allocations (timed_slot_id, pool_type) WHERE timed_slot_id IS NOT NULL;
```

### Decision 10 — Appointment must reference a consistent allocation
An appointment must reference an allocation that:
- Belongs to its own session
- Matches its stored pool type
- Matches its doctor

Enforced via composite foreign keys:
```sql
CONSTRAINT fk_appt_session_doctor_composite
  FOREIGN KEY (session_id, doctor_id)
  REFERENCES elastic_sessions (id, doctor_id),

CONSTRAINT fk_appt_allocation_session_pool_composite
  FOREIGN KEY (allocation_id, session_id, pool_type)
  REFERENCES slot_allocations (id, session_id, pool_type)
```

### Decision 11 — Channel and pool type restrictions
- WEB_PATIENT and WHATSAPP_BOT bookings may only use ADVANCE_BOOKING.
- RECEPTION_DESK bookings may use any permitted pool.
- Enforced by a CHECK constraint on `appointments`.

### Decision 12 — OVERRIDE_OVERFLOW authorization
**SQL-level enforcement:** OVERRIDE_OVERFLOW requires `channel = RECEPTION_DESK`, a non-null `override_authorized_by_user_id`, and a non-empty `override_reason`. Enforced by a CHECK constraint.

**Application-level invariant:** The booking service MUST verify that the user identified by `override_authorized_by_user_id` holds the `ADMIN` or `RECEPTIONIST` role in `user_roles` before allowing the overflow booking. This role check cannot be expressed as a SQL foreign key or check constraint because it depends on querying a separate table. The service must enforce it before insert.

### Decision 13 — Duplicate booking protection
A partial unique index prevents duplicate active bookings for the same patient and session:
```sql
CREATE UNIQUE INDEX idx_appt_patient_session_active
  ON appointments (patient_id, session_id)
  WHERE status <> 'CANCELLED';
```
`NO_SHOW` remains a historical record and does NOT unlock a past session for re-booking.

### Decision 14 — Token numbers
Token numbers are assigned at booking for TOKEN_SESSION appointments and are null for TIMED_SESSION appointments. Token numbers must be positive integers.

### Decision 15 — Rescheduling preserves appointment ID
Rescheduling writes a full before-and-after history row in `reschedule_histories` in the same transaction as the appointment update. The appointment ID is preserved.

### Decision 16 — Immutable reschedule history
Database triggers reject any UPDATE or DELETE on `reschedule_histories`. Referenced appointments, sessions, allocations, and timed slots must not be deleted while history rows depend on them (all enforced with `ON DELETE RESTRICT`).

### Decision 17 — No consent fields
`consent_to_care`, `consent_mode`, and `consent_captured_at` are omitted from `patients`. `whatsapp_opt_in` defaults to false and must not be silently set to true.

### Decision 18 — Authentication tables are schema foundations only
The `users`, `oauth_accounts`, and `verification_tokens` tables are schema foundations. Complete authentication endpoints (Google OAuth, OTP sending, email sending, WhatsApp delivery) are NOT implemented in Stage 2.

### Decision 19 — Real database query for backend health
The health endpoint at `GET /api/v1/health` executes `SELECT 1` against PostgreSQL. A TCP socket check is insufficient.

### Decision 20 — Honest README
The README accurately describes Stage 2 scope. Booking APIs, reminders, authentication flows, and integrations are described as future work.

---

## 2. PostgreSQL-Only Constraints

These constraints are enforced in the migration SQL but cannot be represented in Prisma schema syntax alone.

### 2.1 Partial Unique Indexes

| Table | Index | Description |
|-------|-------|-------------|
| `doctor_specializations` | `idx_doctor_specializations_one_primary` | At most one `is_primary = true` per doctor |
| `elastic_sessions` | `idx_es_source_rule_date` | One generated session per rule per date |
| `slot_allocations` | `idx_sa_session_pool_session_level` | One pool type per session (session-level) |
| `slot_allocations` | `idx_sa_timed_slot_pool` | One pool type per timed slot |
| `appointments` | `idx_appt_patient_session_active` | One active booking per patient per session |
| `appointments` | `idx_appt_session_token` | Unique token number per session |

### 2.2 Exclusion Constraints

| Table | Constraint | Description |
|-------|-----------|-------------|
| `elastic_sessions` | `excl_es_no_overlap_active` | No overlapping non-cancelled sessions for the same doctor on the same date. Uses `btree_gist` extension and `tsrange` overlap operator. |
| `session_timed_slots` | `excl_sts_no_overlap` | No overlapping time slots within the same session. Uses `btree_gist` extension. |

### 2.3 Composite Foreign Keys

These enforce referential integrity beyond what Prisma can represent:

| Child Table | Composite FK | References |
|-------------|-------------|------------|
| `slot_allocations` | `(timed_slot_id, session_id)` | `session_timed_slots(id, session_id)` |
| `appointments` | `(session_id, doctor_id)` | `elastic_sessions(id, doctor_id)` |
| `appointments` | `(allocation_id, session_id, pool_type)` | `slot_allocations(id, session_id, pool_type)` |
| `appointments` | `(timed_slot_id, session_id)` | `session_timed_slots(id, session_id)` |
| `reschedule_histories` | `(previous_allocation_id, previous_session_id, previous_pool_type)` | `slot_allocations(id, session_id, pool_type)` |
| `reschedule_histories` | `(new_allocation_id, new_session_id, new_pool_type)` | `slot_allocations(id, session_id, pool_type)` |
| `reschedule_histories` | `(previous_timed_slot_id, previous_session_id)` | `session_timed_slots(id, session_id)` |
| `reschedule_histories` | `(new_timed_slot_id, new_session_id)` | `session_timed_slots(id, session_id)` |

### 2.4 Database Triggers

#### `trg_appointments_mode_check` (BEFORE INSERT OR UPDATE on `appointments`)
Enforces scheduling mode consistency:
- TOKEN_SESSION: `timed_slot_id` must be NULL; `token_number` must NOT be NULL.
- TIMED_SESSION: `timed_slot_id` must NOT be NULL; `token_number` must be NULL.

#### `trg_reschedule_histories_immutable` (BEFORE UPDATE OR DELETE on `reschedule_histories`)
Rejects any UPDATE or DELETE operation on reschedule history rows.

### 2.5 Check Constraints

| Table | Constraint | Description |
|-------|-----------|-------------|
| `users` | `users_require_email_or_phone` | At least one of email or phone must be non-null |
| `users` | `users_email_lowercase` | Email must be stored in lowercase |
| `patients` | `ck_patient_age_or_dob` | Either `date_of_birth` or `age_estimated_years` must be present |
| `patients` | `ck_patient_age_estimated_range` | Estimated age must be 0–130 if present |
| `doctors` | `ck_doctor_active_requires_approved` | `is_active_for_booking = true` implies `onboarding_status = APPROVED` |
| `doctors` | `ck_doctor_approved_requires_verification` | APPROVED requires non-null `credentials_verified_at` and `verified_by_user_id` |
| `recurring_availability_rules` | `ck_rar_mode_queue_match` | TOKEN_SESSION requires BY_TOKEN; TIMED_SESSION requires BY_ARRIVAL |
| `elastic_sessions` | `ck_es_mode_queue_match` | Same mode-queue pairing requirement |
| `slot_allocations` | `ck_sa_booked_count_range` | `0 <= booked_count <= max_capacity` |
| `appointments` | `ck_appt_channel_pool_type` | WEB_PATIENT and WHATSAPP_BOT require ADVANCE_BOOKING |
| `appointments` | `ck_appt_override_overflow_meta` | OVERRIDE_OVERFLOW requires RECEPTION_DESK, authorizer, and reason |
| `appointments` | `ck_appt_no_override_meta_for_non_overflow` | Non-OVERRIDE_OVERFLOW must not have override metadata |
| `appointments` | `ck_appt_cancelled_metadata` | CANCELLED requires `cancelled_at`, `cancelled_by_role`, non-empty reason |
| `appointments` | `ck_appt_no_cancellation_meta_for_active` | Non-CANCELLED must not have cancellation metadata |
| `notifications` | `ck_notif_one_recipient` | Exactly one of `recipient_patient_id` or `recipient_user_id` must be non-null |
| `notifications` | `ck_notif_read_at_status` | `read_at` non-null exactly when `status = READ` |

---

## 3. Transaction Invariants (Concurrency Contract)

These rules govern all booking and rescheduling operations. Endpoints are NOT implemented in Stage 2 but the transaction contract must be followed when they are built.

### 3.1 Booking Transaction Protocol

1. Begin an explicit database transaction.
2. Lock all affected `slot_allocations` rows with `SELECT ... FOR UPDATE`, ordered consistently by allocation UUID to prevent deadlock.
3. Verify:
   - Correct pool type
   - Session is not CANCELLED or COMPLETED
   - Allocation has `booked_count < max_capacity`
   - No existing non-CANCELLED booking for the same patient and session (the partial unique index enforces this at insert time)
4. If the conditional counter update affects zero rows (capacity exhausted between check and update), abort and return HTTP `409 Conflict`.
5. Increment `booked_count` atomically.
6. Insert the appointment row in the same transaction.

### 3.2 Cancellation Rules

- Decrement `booked_count` only when an appointment transitions from a capacity-consuming state to `CANCELLED`.
- Do NOT decrement twice on repeated cancellation attempts.
- `COMPLETED` and `NO_SHOW` do NOT automatically release historical session capacity.
- A cancellation followed by a new booking is permitted because the unique partial index excludes `CANCELLED` appointments.

### 3.3 Rescheduling Transaction Protocol

1. Begin an explicit database transaction.
2. Lock both old and new `slot_allocations` rows with `SELECT ... FOR UPDATE`, ordered by allocation UUID.
3. Verify new capacity.
4. Transfer `booked_count` (decrement old, increment new) using conditional updates.
5. Update the appointment row (preserving the appointment ID).
6. Insert the immutable `reschedule_histories` row.
7. Commit the transaction. Steps 5 and 6 are atomic.

### 3.4 Error Handling

- Retry on PostgreSQL SQLSTATE `40001` (serialization failure) and `40P01` (deadlock) with a bounded retry policy (suggested: 3 retries with exponential backoff) in the future service.
- If conditional counter update affects zero rows, return HTTP `409 Conflict` immediately without retry.

### 3.5 Capacity Reduction Rules

- Capacity cannot be reduced below its consumed count (`booked_count`). The CHECK constraint `ck_sa_booked_count_range` enforces `0 <= booked_count <= max_capacity` — a capacity reduction that would violate this is rejected at the database level.
- When hours are shrunk, the default policy is to block the shrink if any booked appointment would fall outside the new hours. Existing appointments must be explicitly rescheduled or cancelled before the shrink proceeds.
- Raising capacity may trigger re-engagement notifications for waitlisted patients; actual notification delivery is outside Stage 2.

---

## 4. 12-Scenario Validation Matrix

These scenarios describe what the schema and future transaction/service layer must guarantee. Application workflows are **not yet implemented** in Stage 2.

---

### Scenario 1 — Patient Registration by Email or Google OAuth

**What the schema must guarantee:**
- One `users` row per identity. Email is stored lowercase (enforced by CHECK constraint).
- OAuth provider identity is stored in `oauth_accounts` separately from `users`.
- A `user_roles` row with `role = 'PATIENT'` links the user to the patient role.
- A `patients` row may be created separately (or concurrently) and linked via `patients.user_id`.
- `verification_tokens` stores only the HMAC hash of the token/OTP — never the plaintext.
- **Application invariant:** The verification service must HMAC the token with a server-side secret, enforce single-use via `consumed_at`, enforce expiration via `expires_at`, and rate-limit failed attempts via `attempt_count`.

---

### Scenario 2 — Reception Desk Patient Registration Without Login

**What the schema must guarantee:**
- `patients.user_id` is nullable. A desk-created patient record has `user_id = NULL`.
- `patients.registered_by_user_id` may record the staff member who created the record.
- `patients.contact_phone` is indexed but NOT unique — family members may share a guardian's phone.
- No consent-to-care fields are present; `whatsapp_opt_in` defaults to false.

---

### Scenario 3 — Doctor Onboarding and Verification

**What the schema must guarantee:**
- `(medical_council, registration_number)` is a unique pair — no duplicate medical registrations.
- One-to-one `doctor_profiles` record per doctor.
- Specializations are assigned via `doctor_specializations`; at most one may be primary.
- `onboarding_status = 'APPROVED'` requires non-null `credentials_verified_at` and `verified_by_user_id` (enforced by CHECK).
- `is_active_for_booking = true` requires `onboarding_status = 'APPROVED'` (enforced by CHECK).
- **Application invariant:** Only users with `ADMIN` role may set `onboarding_status = 'APPROVED'` and set `is_active_for_booking = true`.

---

### Scenario 4 — Two Patients Competing for the Final Capacity Slot

**What the schema must guarantee:**
- Both booking requests lock the `slot_allocations` row with `SELECT ... FOR UPDATE`.
- Only one succeeds in the conditional increment (`UPDATE ... SET booked_count = booked_count + 1 WHERE booked_count < max_capacity`).
- The second request either gets blocked (waiting for the lock) and then sees capacity exhausted, or collides at the unique partial index.
- The losing request receives HTTP `409 Conflict`.
- `booked_count` never exceeds `max_capacity` (enforced by CHECK constraint `ck_sa_booked_count_range`).

---

### Scenario 5 — Token-Based Booking

**What the schema must guarantee:**
- The appointment has `timed_slot_id = NULL` (enforced by the mode trigger and a CHECK on token_number).
- `token_number` is a positive integer assigned at booking.
- `(session_id, token_number)` is unique when non-null (partial unique index `idx_appt_session_token`).
- `elastic_sessions.last_issued_token` is incremented as part of the booking transaction.
- Queue order is BY_TOKEN (enforced by `ck_es_mode_queue_match`).

---

### Scenario 6 — Timed Booking

**What the schema must guarantee:**
- The appointment references an actual `session_timed_slots` row.
- `token_number` is null (enforced by the mode trigger).
- Capacity is owned by the allocation pool associated with the timed slot — not by the slot row itself.
- The allocation pool `(timed_slot_id IS NOT NULL, pool_type)` governs how many patients may book the slot.
- The composite FK `(timed_slot_id, session_id) -> session_timed_slots(id, session_id)` ensures the slot belongs to the correct session.

---

### Scenario 7 — Expansion of Consulting Hours

**What the schema must guarantee:**
- A new `elastic_sessions` interval for the same doctor on the same date must not overlap any existing non-CANCELLED session (enforced by the `excl_es_no_overlap_active` exclusion constraint).
- New `session_timed_slots` within the expanded session must not overlap existing slots in the same session (enforced by `excl_sts_no_overlap`).
- New `slot_allocations` rows for the expanded capacity must be created transactionally with the session or slot rows.
- **Application invariant:** All slot and allocation insertions for a session must occur within a single transaction.

---

### Scenario 8 — Shrinking Hours With Existing Appointments

**What the schema must guarantee:**
- The schema does not automatically cascade deletions or silent displacements.
- The default policy is to **hard-block** a shrink that would invalidate booked appointments until they are explicitly rescheduled or cancelled.
- **Application invariant:** Before shrinking session hours or removing timed slots, the service must check for non-CANCELLED appointments referencing the affected slots or time ranges. If any exist, it must return an error and require explicit resolution.
- If a timed slot's status is set to `BLOCKED_BY_SHRINK`, existing appointments on it are unaffected at the database level but may be handled by the future notification service.

---

### Scenario 9 — Capacity Adjustment

**What the schema must guarantee:**
- `slot_allocations.max_capacity >= 0` (CHECK constraint).
- `slot_allocations.booked_count <= max_capacity` (CHECK constraint). A capacity reduction that would violate this is rejected at the database level.
- **Application invariant:** The service must not reduce `max_capacity` below `booked_count`.
- Raising `max_capacity` may trigger re-engagement notifications for patients who were unable to book. Notification record creation uses idempotency keys to prevent duplicates. Actual delivery is outside Stage 2.

---

### Scenario 10 — Cancellation and Rebooking

**What the schema must guarantee:**
- A CANCELLED appointment must have `cancelled_at`, `cancelled_by_role`, and a non-empty `cancellation_reason` (CHECK constraint).
- Non-cancelled appointments must not have cancellation metadata (CHECK constraint).
- `booked_count` decrements only on the first transition to CANCELLED — duplicate cancellation attempts are rejected before the decrement.
- The partial unique index `idx_appt_patient_session_active` excludes CANCELLED appointments, so a new booking in the same session is permitted after cancellation.
- **Application invariant:** The service must guard against decrementing `booked_count` twice by checking the current appointment status before updating.

---

### Scenario 11 — Rescheduling With History

**What the schema must guarantee:**
- The appointment row is updated in place (same ID preserved).
- A `reschedule_histories` row is inserted with the full before-and-after state (both session IDs, allocation IDs, pool types, and optionally timed slot IDs and token numbers).
- Both the appointment update and the history insert occur in the same database transaction.
- Both old and new allocation rows are locked in UUID order before modification.
- The history row is immutable after insert (trigger rejects UPDATE and DELETE).
- Referenced sessions, allocations, and timed slots cannot be deleted while history rows depend on them (ON DELETE RESTRICT).

---

### Scenario 12 — Reminder and Cancellation Notification Records

**What the schema must guarantee:**
- Notification records are stored with `idempotency_key` (unique) to prevent duplicate dispatch records.
- `payload_snapshot` (JSONB) preserves the notification content at the time of creation.
- `status` tracks the dispatch state: QUEUED → SENT → DELIVERED → READ or FAILED.
- `read_at` is non-null exactly when `status = READ` (enforced by CHECK constraint).
- Exactly one recipient (either `recipient_patient_id` or `recipient_user_id`) is non-null (enforced by CHECK constraint).
- Recipient deletion uses `ON DELETE RESTRICT` to preserve notification audit history.
- **Stage 2 boundary:** Actual email, SMS, and WhatsApp delivery is NOT implemented. Only the dispatch record is stored.

---

## 5. Stage 2 Boundary Summary

| Feature | Stage 2 Status |
|---------|---------------|
| 17-table PostgreSQL schema | ✅ Implemented |
| Prisma ORM schema + migration | ✅ Implemented |
| NestJS backend skeleton | ✅ Implemented |
| Next.js frontend foundation | ✅ Implemented |
| `GET /api/v1/health` (real DB query) | ✅ Implemented |
| ER diagram and documentation | ✅ Implemented |
| Booking / rescheduling API | 🔲 Future |
| Patient registration API | 🔲 Future |
| Doctor onboarding API | 🔲 Future |
| Authentication / Google OAuth | 🔲 Future |
| OTP verification | 🔲 Future |
| Email / SMS / WhatsApp delivery | 🔲 Future |
| Session management API | 🔲 Future |
| Capacity management API | 🔲 Future |
