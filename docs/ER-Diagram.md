# Schedula — ER Diagram

## Entity-Relationship Diagram

```mermaid
erDiagram
    users {
        uuid id PK
        varchar email UK
        varchar phone
        varchar password_hash
        user_account_status status
        boolean is_email_verified
        boolean is_phone_verified
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }

    oauth_accounts {
        uuid id PK
        uuid user_id FK
        oauth_provider provider
        varchar provider_account_id
        varchar provider_email
        timestamptz linked_at
    }

    user_roles {
        uuid id PK
        uuid user_id FK
        app_role role
        timestamptz granted_at
        uuid granted_by_user_id FK
    }

    verification_tokens {
        uuid id PK
        uuid user_id FK
        verification_token_purpose purpose
        varchar target
        varchar token_hash
        timestamptz expires_at
        timestamptz consumed_at
        integer attempt_count
        timestamptz created_at
    }

    patients {
        uuid id PK
        uuid user_id FK "nullable, unique"
        varchar patient_code UK
        varchar given_name
        varchar family_name
        sex_type sex
        date date_of_birth
        smallint age_estimated_years
        varchar contact_phone
        varchar alternate_phone
        varchar email
        varchar guardian_name
        varchar old_file_number
        boolean whatsapp_opt_in
        uuid registered_by_user_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    doctors {
        uuid id PK
        uuid user_id FK UK
        varchar doctor_code UK
        doctor_onboarding_status onboarding_status
        varchar medical_council
        varchar registration_number
        timestamptz credentials_verified_at
        uuid verified_by_user_id FK
        boolean is_active_for_booking
        timestamptz created_at
        timestamptz updated_at
    }

    doctor_profiles {
        uuid id PK
        uuid doctor_id FK UK
        varchar display_name
        varchar qualifications
        text bio
        integer years_of_experience
        timestamptz updated_at
    }

    specializations {
        uuid id PK
        varchar code UK
        varchar name UK
        text description
        boolean is_active
    }

    doctor_specializations {
        uuid doctor_id PK_FK
        uuid specialization_id PK_FK
        boolean is_primary
        timestamptz assigned_at
    }

    recurring_availability_rules {
        uuid id PK
        uuid doctor_id FK
        smallint day_of_week
        time start_time
        time end_time
        scheduling_mode session_mode
        queue_ordering_rule queue_order
        integer slot_duration_minutes
        integer default_advance_capacity
        integer default_walkin_capacity
        date effective_from
        date effective_to
        boolean is_active
    }

    availability_exceptions {
        uuid id PK
        uuid doctor_id FK
        date exception_date
        time start_time
        time end_time
        exception_type kind
        text reason
        timestamptz created_at
    }

    elastic_sessions {
        uuid id PK
        uuid doctor_id FK
        uuid source_rule_id FK
        date session_date
        time start_time
        time end_time
        scheduling_mode session_mode
        queue_ordering_rule queue_order
        session_lifecycle_status status
        integer delay_offset_minutes
        boolean allow_quota_override
        integer last_issued_token
        integer version
        timestamptz consulting_ended_at
        timestamptz noshow_swept_at
        timestamptz created_at
        timestamptz updated_at
    }

    session_timed_slots {
        uuid id PK
        uuid session_id FK
        time slot_start_time
        time slot_end_time
        timed_slot_status status
        timestamptz created_at
    }

    slot_allocations {
        uuid id PK
        uuid session_id FK
        uuid timed_slot_id FK
        allocation_pool_type pool_type
        integer max_capacity
        integer booked_count
        integer version
        timestamptz updated_at
    }

    appointments {
        uuid id PK
        varchar booking_reference UK
        uuid patient_id FK
        uuid doctor_id FK
        uuid session_id FK
        uuid allocation_id FK
        uuid timed_slot_id FK
        allocation_pool_type pool_type
        integer token_number
        visit_type visit_kind
        booking_channel_type channel
        appointment_status status
        boolean is_emergency_priority
        text reason_for_visit
        varchar referred_by_name
        uuid booked_by_user_id FK
        uuid override_authorized_by_user_id FK
        text override_reason
        timestamptz checked_in_at
        timestamptz consult_started_at
        timestamptz completed_at
        timestamptz cancelled_at
        cancellation_actor_type cancelled_by_role
        text cancellation_reason
        timestamptz created_at
        timestamptz updated_at
    }

    reschedule_histories {
        uuid id PK
        uuid appointment_id FK
        uuid previous_session_id FK
        uuid previous_allocation_id FK
        uuid previous_timed_slot_id FK
        allocation_pool_type previous_pool_type
        integer previous_token_number
        uuid new_session_id FK
        uuid new_allocation_id FK
        uuid new_timed_slot_id FK
        allocation_pool_type new_pool_type
        integer new_token_number
        uuid rescheduled_by_user_id FK
        reschedule_initiator_type initiator_role
        text reason
        timestamptz rescheduled_at
    }

    notifications {
        uuid id PK
        uuid appointment_id FK
        uuid recipient_patient_id FK
        uuid recipient_user_id FK
        notification_channel channel
        notification_event_type event_type
        varchar template_code
        jsonb payload_snapshot
        notification_delivery_status status
        varchar idempotency_key UK
        text failure_reason
        timestamptz scheduled_for
        timestamptz sent_at
        timestamptz delivered_at
        timestamptz read_at
        timestamptz created_at
    }

    users ||--o{ oauth_accounts : "has"
    users ||--o{ user_roles : "holds"
    users ||--o{ verification_tokens : "owns"
    users ||--o| patients : "may be linked as"
    users ||--o| doctors : "may be"
    users ||--o{ patients : "registers (staff)"
    doctors ||--o| doctor_profiles : "has one"
    doctors ||--o{ doctor_specializations : "assigned"
    specializations ||--o{ doctor_specializations : "used by"
    doctors ||--o{ recurring_availability_rules : "defines"
    doctors ||--o{ availability_exceptions : "has"
    doctors ||--o{ elastic_sessions : "runs"
    recurring_availability_rules ||--o{ elastic_sessions : "generates"
    elastic_sessions ||--o{ session_timed_slots : "contains"
    elastic_sessions ||--o{ slot_allocations : "has pools"
    session_timed_slots ||--o{ slot_allocations : "has slot-level pools"
    patients ||--o{ appointments : "books"
    doctors ||--o{ appointments : "receives"
    elastic_sessions ||--o{ appointments : "contains"
    slot_allocations ||--o{ appointments : "consumed by"
    session_timed_slots ||--o{ appointments : "at"
    appointments ||--o{ reschedule_histories : "has (immutable)"
    elastic_sessions ||--o{ reschedule_histories : "previous session"
    elastic_sessions ||--o{ reschedule_histories : "new session"
    appointments ||--o{ notifications : "triggers"
    patients ||--o{ notifications : "receives"
```

---

## Entity / Relationship Catalogue

### Module 1 — User

| Table | Description |
|-------|-------------|
| `users` | Core identity record. Requires at least one of email or phone. Enforces lowercase email storage. |
| `oauth_accounts` | Linked OAuth provider identities (currently Google). Separate from the users identity record. |
| `user_roles` | Multi-role assignments (PATIENT, DOCTOR, RECEPTIONIST, ADMIN). One user may hold multiple roles. |
| `verification_tokens` | Hashed tokens/OTPs for email verification, phone OTP, doctor invite, and password reset. Token hashes are NOT globally unique — duplicate short OTPs across different records are permitted. |

### Module 2 — Patient

| Table | Description |
|-------|-------------|
| `patients` | Patient demographics, contact information, and optional user account link. `user_id` is nullable — reception-desk-created records may have no login. Contact phone is indexed but not unique (family members may share a guardian's phone). |

### Module 3 — Doctor

| Table | Description |
|-------|-------------|
| `doctors` | Doctor identity, onboarding status, and medical council registration. Booking eligibility requires APPROVED status with verified credentials. |
| `doctor_profiles` | One-to-one display profile: display name, qualifications, experience. No billing or fee fields in Stage 2. |
| `specializations` | Canonical specialization catalogue. |
| `doctor_specializations` | Many-to-many junction. At most one primary specialization per doctor enforced by a partial unique index. |

### Module 4 — Availability

| Table | Description |
|-------|-------------|
| `recurring_availability_rules` | Weekly recurring schedule rules per doctor. Mode-queue pairing enforced: TOKEN_SESSION requires BY_TOKEN; TIMED_SESSION requires BY_ARRIVAL. |
| `availability_exceptions` | Overrides for leaves, holidays, emergency closures, or custom hours. Full-day exceptions have both times null; partial-day exceptions require both times. |
| `elastic_sessions` | Actual clinic sessions generated from rules or created ad-hoc. Has an exclusion constraint preventing overlapping non-cancelled sessions for the same doctor on the same date. |
| `slot_allocations` | Capacity pools per session (or per timed slot). Three pool types: ADVANCE_BOOKING, WALK_IN_RESERVE, OVERRIDE_OVERFLOW. `booked_count` is the single authoritative counter. |
| `session_timed_slots` | Time-slot rows for timed sessions. Contains no capacity counter — capacity is owned entirely by `slot_allocations`. |

### Module 5 — Appointment

| Table | Description |
|-------|-------------|
| `appointments` | Patient bookings with full lifecycle tracking. Composite foreign keys enforce session/doctor/allocation/pool consistency. A PostgreSQL trigger enforces mode-slot-token consistency. |
| `reschedule_histories` | Immutable before/after audit log. PostgreSQL triggers reject UPDATE and DELETE. |
| `notifications` | Dispatch records with payload snapshots and idempotency keys. Actual delivery is not implemented in Stage 2. |

---

## Constraints Not Fully Expressible in Mermaid

The following constraints are enforced in the migration SQL but cannot be represented in Mermaid diagrams:

1. **Composite foreign keys** on `appointments` linking `(session_id, doctor_id)` to `elastic_sessions(id, doctor_id)`, `(allocation_id, session_id, pool_type)` to `slot_allocations(id, session_id, pool_type)`, and `(timed_slot_id, session_id)` to `session_timed_slots(id, session_id)`.
2. **Partial unique indexes** on `slot_allocations` (session-level and timed-slot-level pools), `appointments` (active booking per patient per session, excluding CANCELLED), and `doctor_specializations` (one primary per doctor).
3. **Exclusion constraints** on `elastic_sessions` (no overlapping active sessions per doctor per date) and `session_timed_slots` (no overlapping slots within a session), using `btree_gist`.
4. **Immutability triggers** on `reschedule_histories` rejecting UPDATE and DELETE.
5. **Mode enforcement trigger** on `appointments` ensuring token sessions have no timed slot and have a token number, and timed sessions have a timed slot and no token number.
6. **Check constraints** on `appointments`: OVERRIDE_OVERFLOW requires RECEPTION_DESK channel, non-null authorizer, non-empty reason; WEB_PATIENT and WHATSAPP_BOT require ADVANCE_BOOKING; cancelled appointments require cancellation metadata.
