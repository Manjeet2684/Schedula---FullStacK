# Schedula — Doctor–Patient Scheduling System

**Stage 2 Foundation — PearlThoughts Full-Stack Developer Internship**

Schedula is a doctor–patient appointment and scheduling management system. This repository contains the Stage 2 foundation: the complete database schema, Prisma ORM setup, NestJS backend skeleton, and Next.js frontend skeleton.

Prototype reference (behavioural reference only, not production architecture):
- https://app.dev.medrella.com/prototype/app-shell

Programme plan:
- https://github.com/PearlThoughtsInternship/Internship-Obsidian-Vault/blob/main/Programme-Structure/Weekly-Plans.md

---

## Stage 2 Scope

This stage delivers:

- **17-table PostgreSQL schema** covering five modules: User, Patient, Doctor, Availability, Appointment
- **Prisma ORM** schema and initial migration
- **NestJS backend** bootstrapped with `NestFactory.create(AppModule)`, global prefix `api/v1`, and a database health endpoint
- **Next.js 16 App Router frontend** foundation page
- **ER diagram**, design documentation, and a 12-scenario validation matrix
- **Validation scripts** (`scripts/validate-er.js`, `scripts/verify-db.sql`)

### Stage 2 Boundary — What Is NOT Yet Implemented

The following features are **planned for future stages** and are **not implemented** here:

- Booking and rescheduling API endpoints
- Authentication and verification flows (Google OAuth, email/phone OTP, password reset)
- External notification delivery (email, SMS, WhatsApp)
- Billing, consultation fees, EMR/vitals, prescriptions
- Multi-tenant / multi-clinic support
- Complete admin dashboard or receptionist UI workflows

---

## Technology Stack

| Component       | Version |
|-----------------|---------|
| Node.js         | 24.22.1 |
| Next.js         | 16.4.3  |
| React / ReactDOM| 19.2.0  |
| NestJS core     | 12.0.3  |
| Nest CLI        | 12.0.10 |
| Prisma CLI / Client / Adapter | 7.10.1 |
| PostgreSQL      | 17      |
| TypeScript      | 5.9.3   |
| pg (PostgreSQL driver) | 8.x |

All direct dependencies are pinned to exact versions.

---

## Five Modules and 17 Tables

### 1. User Module
- `users` — Identity records (email/phone login, status, verification flags)
- `oauth_accounts` — Linked OAuth provider identities (Google)
- `user_roles` — Multi-role assignments (PATIENT, DOCTOR, RECEPTIONIST, ADMIN)
- `verification_tokens` — Hashed OTP/email tokens for verification flows (foundation only)

### 2. Patient Module
- `patients` — Patient demographics, contact info, optional user link (desk patients may have no login)

### 3. Doctor Module
- `doctors` — Doctor records, onboarding status, medical registration
- `doctor_profiles` — Display name, qualifications, experience (one-to-one with doctors)
- `specializations` — Canonical specialization catalogue
- `doctor_specializations` — Many-to-many junction; at most one primary specialization per doctor

### 4. Availability Module
- `recurring_availability_rules` — Weekly recurring schedules per doctor
- `availability_exceptions` — Leaves, holidays, custom hours overriding the rule
- `elastic_sessions` — Actual clinic sessions (generated from rules or created manually)
- `slot_allocations` — Capacity pools (ADVANCE_BOOKING, WALK_IN_RESERVE, OVERRIDE_OVERFLOW)
- `session_timed_slots` — Time-slot rows for timed sessions

### 5. Appointment Module
- `appointments` — Individual patient bookings, full lifecycle tracking
- `reschedule_histories` — Immutable before/after reschedule audit log
- `notifications` — Notification dispatch records and payload snapshots

---

## Key Design Concepts

### Token Sessions vs Timed Sessions
- **TOKEN_SESSION**: Patients receive a sequential token number at booking. No timed-slot row exists; queue order is `BY_TOKEN`.
- **TIMED_SESSION**: Each patient selects a specific time slot from `session_timed_slots`. Queue order is `BY_ARRIVAL`.

### Allocation Pools
Every session (or timed slot within a session) has one or more `slot_allocations` rows, one per pool type:
- `ADVANCE_BOOKING` — Pre-bookable online or via reception
- `WALK_IN_RESERVE` — Walk-in capacity reserved at the session level
- `OVERRIDE_OVERFLOW` — Emergency overflow; requires ADMIN/RECEPTIONIST authorizer and a non-empty reason

`booked_count` on each allocation row is the **single authoritative capacity counter**. It is incremented on booking and decremented on cancellation (guarded against double-decrement).

### Optional Patient Login
`patients.user_id` is nullable. Reception desk staff can create patient records without requiring the patient to have a login account. A shared phone number (e.g. guardian's phone) is indexed but not forced unique.

### Appointment Lifecycle
`BOOKED` → `CHECKED_IN` → `IN_CONSULT` → `COMPLETED` / `NO_SHOW` / `CANCELLED`

A cancelled appointment retains immutable cancellation metadata. `NO_SHOW` is a permanent historical record and does not release session capacity.

### Immutable Reschedule History
Rescheduling preserves the appointment ID and writes a full before/after `reschedule_histories` row in the same database transaction. Database triggers reject any `UPDATE` or `DELETE` on history rows.

### Notification Records
`notifications` stores dispatch records with payload snapshots and idempotency keys. Actual email/SMS/WhatsApp delivery is **not implemented** in Stage 2.

---

## Prerequisites

- Node.js 24.22.1 (use `.nvmrc`: `nvm use`)
- npm 10+
- Docker and Docker Compose (for PostgreSQL)
- PostgreSQL client tools (optional, for `psql`)

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd schedula
nvm use
npm install
```

### 2. Copy environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Edit `backend/.env` with your actual secrets before running.

### 3. Start the database

> The database listens on **host port 5433** (mapped to container port 5432) to avoid collision with a locally-running PostgreSQL instance.

```bash
npm run db:start
# Wait for the health check to pass
docker compose ps
```

### 4. Generate Prisma client and apply migrations

```bash
npm run prisma:generate
npm run db:migrate
```

### 5. Start the backend

```bash
npm run dev:api
# Backend available at http://localhost:4000/api/v1
```

### 6. Start the frontend

```bash
npm run dev:frontend
# Frontend available at http://localhost:3000
```

---

## Database Health Endpoint

```
GET http://localhost:4000/api/v1/health
```

Returns HTTP 200 when a live `SELECT 1` query to PostgreSQL succeeds.
Returns HTTP 503 with a safe error message if the database is unreachable.

---

## Available Scripts (root workspace)

| Script | Description |
|--------|-------------|
| `npm run dev:api` | Start backend in watch mode |
| `npm run dev:frontend` | Start Next.js dev server |
| `npm run build:backend` | Nest CLI production build |
| `npm run build:frontend` | Next.js production build |
| `npm run typecheck:backend` | TypeScript typecheck (backend) |
| `npm run typecheck:frontend` | TypeScript typecheck (frontend) |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run db:start` | Start PostgreSQL via Docker Compose |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run validate:er` | Run ER contract validator |
| `npm run verify:db` | Print instructions for DB verification |

---

## ER Diagram and Documentation

| File | Description |
|------|-------------|
| `docs/ER-Diagram.mmd` | Raw Mermaid erDiagram source |
| `docs/ER-Diagram.md` | Diagram with entity/relationship catalogue |
| `docs/ER-Diagram-Review.md` | Design decisions, constraints, transaction invariants, 12-scenario matrix |
| `docs/erd-contract.json` | Machine-readable contract used by `scripts/validate-er.js` |

---

## Validation Scripts

### ER Contract Validator

```bash
npm run validate:er
# or
node scripts/validate-er.js
```

Reads `docs/erd-contract.json` and validates that all required tables, columns, enum mappings, relationships, and named constraints are present in the Mermaid diagram, Prisma schema, migration SQL, and documentation files. Exits with a non-zero code on failure.

### Database Verification SQL

> **WARNING: Run only against a disposable test database. All fixtures are rolled back.**

```bash
# Ensure you have a test database available, then:
psql postgresql://schedula:schedula_dev_password@localhost:5433/schedula_test -f scripts/verify-db.sql
```

Covers 12 constraint scenarios including duplicate booking rejection, cancellation/rebooking, capacity overflow, overlapping sessions, immutability triggers, and more.

---

## Concurrency Contract (Summary)

All booking and rescheduling operations must:
1. Run inside an explicit database transaction
2. Lock `slot_allocations` rows with `SELECT ... FOR UPDATE` ordered by UUID
3. Use conditional counter updates; abort with HTTP 409 if zero rows affected
4. Retry on PostgreSQL SQLSTATE `40001` (serialization failure) and `40P01` (deadlock) with bounded retries

Full details in `docs/ER-Diagram-Review.md`.

---

## License

MIT — PearlThoughts Internship Project
