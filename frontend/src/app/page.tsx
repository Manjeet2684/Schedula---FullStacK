const modules = [
  {
    label: 'User',
    tables: ['users', 'oauth_accounts', 'user_roles', 'verification_tokens'],
    description: 'Identity, authentication foundation, and role management.',
  },
  {
    label: 'Patient',
    tables: ['patients'],
    description:
      'Patient demographics and contact info. Login account is optional — desk-registered patients may have no user account.',
  },
  {
    label: 'Doctor',
    tables: ['doctors', 'doctor_profiles', 'specializations', 'doctor_specializations'],
    description: 'Doctor onboarding, profiles, and specialization assignments.',
  },
  {
    label: 'Availability',
    tables: [
      'recurring_availability_rules',
      'availability_exceptions',
      'elastic_sessions',
      'slot_allocations',
      'session_timed_slots',
    ],
    description:
      'Weekly rules, exceptions, clinic sessions, and capacity allocation pools (Advance Booking, Walk-in Reserve, Override Overflow).',
  },
  {
    label: 'Appointment',
    tables: ['appointments', 'reschedule_histories', 'notifications'],
    description:
      'Booking lifecycle, immutable reschedule audit history, and notification dispatch records.',
  },
];

export default function HomePage() {
  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.badge}>Stage 2 Foundation</div>
          <h1 style={styles.title}>Schedula</h1>
          <p style={styles.subtitle}>Doctor–Patient Appointment &amp; Scheduling System</p>
          <p style={styles.description}>
            A full-stack scheduling platform for clinics. This is the Stage 2 foundation
            — database schema, backend skeleton, and frontend scaffold. Business workflows
            (booking, authentication, notifications) are planned for future stages.
          </p>
        </header>

        {/* Five Modules */}
        <section aria-labelledby="modules-heading">
          <h2 id="modules-heading" style={styles.sectionHeading}>
            Five Modules — 17 Tables
          </h2>
          <div style={styles.moduleGrid}>
            {modules.map((mod) => (
              <article key={mod.label} style={styles.moduleCard}>
                <h3 style={styles.moduleLabel}>{mod.label} Module</h3>
                <p style={styles.moduleDesc}>{mod.description}</p>
                <ul style={styles.tableList} aria-label={`${mod.label} module tables`}>
                  {mod.tables.map((t) => (
                    <li key={t} style={styles.tableItem}>
                      <code style={styles.code}>{t}</code>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* Key Concepts */}
        <section aria-labelledby="concepts-heading" style={styles.conceptsSection}>
          <h2 id="concepts-heading" style={styles.sectionHeading}>
            Key Design Concepts
          </h2>
          <dl style={styles.conceptList}>
            <div style={styles.conceptItem}>
              <dt style={styles.conceptTerm}>Token Sessions</dt>
              <dd style={styles.conceptDef}>
                Patients receive a sequential token at booking. No timed-slot row exists.
                Queue order is by token number.
              </dd>
            </div>
            <div style={styles.conceptItem}>
              <dt style={styles.conceptTerm}>Timed Sessions</dt>
              <dd style={styles.conceptDef}>
                Each patient selects a specific time slot. Capacity is owned by allocation
                pools, not by the slot row itself.
              </dd>
            </div>
            <div style={styles.conceptItem}>
              <dt style={styles.conceptTerm}>Allocation Pools</dt>
              <dd style={styles.conceptDef}>
                Every session has capacity pools:{' '}
                <code style={styles.code}>ADVANCE_BOOKING</code>,{' '}
                <code style={styles.code}>WALK_IN_RESERVE</code>, and{' '}
                <code style={styles.code}>OVERRIDE_OVERFLOW</code>. The{' '}
                <code style={styles.code}>booked_count</code> column is the single
                authoritative counter.
              </dd>
            </div>
            <div style={styles.conceptItem}>
              <dt style={styles.conceptTerm}>Optional Patient Login</dt>
              <dd style={styles.conceptDef}>
                Reception desk staff can create patient records without requiring a login
                account. <code style={styles.code}>patients.user_id</code> is nullable.
              </dd>
            </div>
          </dl>
        </section>

        {/* API Health */}
        <section aria-labelledby="api-heading" style={styles.apiSection}>
          <h2 id="api-heading" style={styles.sectionHeading}>
            Backend API
          </h2>
          <p style={styles.description}>
            The NestJS backend runs at{' '}
            <code style={styles.code}>http://localhost:4000/api/v1</code>.
          </p>
          <p style={styles.description}>
            Database health endpoint:{' '}
            <code style={styles.code}>GET /api/v1/health</code>
          </p>
          <p style={styles.stageNotice}>
            ⚠ Booking, authentication, and notification delivery APIs are not yet implemented.
            This stage delivers the database schema and application skeleton.
          </p>
        </section>

        {/* Footer */}
        <footer style={styles.footer}>
          <p>
            Schedula — PearlThoughts Full-Stack Developer Internship &middot; Stage 2 Foundation
          </p>
        </footer>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    backgroundColor: '#f7f8fa',
    padding: '2rem 1rem',
  },
  container: {
    maxWidth: '760px',
    margin: '0 auto',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '2.5rem',
  },
  header: {
    marginBottom: '2.5rem',
    paddingBottom: '2rem',
    borderBottom: '1px solid #e5e7eb',
  },
  badge: {
    display: 'inline-block',
    padding: '0.2rem 0.6rem',
    backgroundColor: '#f0ecff',
    color: '#7c5cd8',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '4px',
    marginBottom: '0.75rem',
    letterSpacing: '0.03em',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#1f2328',
    marginBottom: '0.4rem',
  },
  subtitle: {
    fontSize: '1.05rem',
    color: '#57606a',
    marginBottom: '1rem',
  },
  description: {
    fontSize: '14px',
    color: '#57606a',
    lineHeight: 1.65,
    marginBottom: '0.75rem',
  },
  sectionHeading: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1f2328',
    marginBottom: '1rem',
    paddingBottom: '0.4rem',
    borderBottom: '1px solid #e5e7eb',
  },
  moduleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1rem',
    marginBottom: '2.5rem',
  },
  moduleCard: {
    backgroundColor: '#f7f8fa',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '1rem 1.25rem',
  },
  moduleLabel: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#3b82d4',
    marginBottom: '0.4rem',
  },
  moduleDesc: {
    fontSize: '13px',
    color: '#57606a',
    marginBottom: '0.6rem',
    lineHeight: 1.5,
  },
  tableList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  tableItem: {
    padding: '0.1rem 0',
  },
  code: {
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: '12px',
    backgroundColor: '#f0f1f3',
    color: '#1f2328',
    padding: '0.1rem 0.3rem',
    borderRadius: '3px',
  },
  conceptsSection: {
    marginBottom: '2.5rem',
  },
  conceptList: {
    display: 'grid',
    gap: '1rem',
  },
  conceptItem: {
    backgroundColor: '#f7f8fa',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '0.9rem 1.25rem',
  },
  conceptTerm: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#1f2328',
    marginBottom: '0.3rem',
  },
  conceptDef: {
    fontSize: '13px',
    color: '#57606a',
    lineHeight: 1.55,
    margin: 0,
  },
  apiSection: {
    marginBottom: '2.5rem',
  },
  stageNotice: {
    fontSize: '13px',
    color: '#57606a',
    backgroundColor: '#fffbf0',
    border: '1px solid #f0d88a',
    borderRadius: '4px',
    padding: '0.6rem 0.9rem',
    lineHeight: 1.55,
  },
  footer: {
    paddingTop: '1.5rem',
    borderTop: '1px solid #e5e7eb',
    textAlign: 'center',
    fontSize: '12px',
    color: '#57606a',
  },
};
