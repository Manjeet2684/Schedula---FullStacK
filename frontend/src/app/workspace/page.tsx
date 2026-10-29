'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, localDate, money } from '../../lib/api';

type User = { id: string; email: string | null; roles: string[]; patientId: string | null; doctor?: { id: string; onboardingStatus: string } | null };
type Doctor = { id: string; name: string; qualifications: string; fees: { newVisitMinor: number; followUpMinor: number; currency: string }; specializations: Array<{ name: string }> };
type Patient = { id: string; patientCode: string; givenName: string; familyName: string | null; contactPhone: string; sex: string; dateOfBirth?: string | null; ageEstimatedYears?: number | null };
type PendingDoctor = { id: string; medicalCouncil: string; registrationNumber: string; profile?: { displayName: string; qualifications: string } | null; user?: { email: string | null } | null };
type AdminDoctor = { id: string; name: string; qualifications: string; fees: { newVisitMinor: number; followUpMinor: number; currency: string }; email: string | null; onboardingStatus: string; specializations: Array<{ id: string; name: string; primary: boolean }> };
type AdminSpecialization = { id: string; name: string; code: string; isActive: boolean };
type StaffUser = { id: string; email: string | null; phone: string | null; status: string; roles: string[] };
type Allocation = { id: string; poolType: string; bookable: boolean; availableCount: number; startTime: string | null; endTime: string | null };
type Session = { id: string; date: string; startTime: string; endTime: string; mode: string; allocations: Allocation[] };
type Appointment = { id: string; bookingReference: string; status: string; tokenNumber: number | null; patient?: { givenName: string; familyName: string | null; contactPhone: string }; doctor?: { profile?: { displayName: string } | null }; session: { startTime: string; endTime: string; sessionDate: string }; timedSlot?: { slotStartTime: string; slotEndTime: string } | null };

export default function WorkspacePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(localDate());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [overview, setOverview] = useState<{ doctors: number; patients: number; appointments: number; pendingDoctors: number } | null>(null);
  const [pending, setPending] = useState<PendingDoctor[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialtyForm, setSpecialtyForm] = useState({ name: '', code: '', description: '' });
  const [feeForm, setFeeForm] = useState({ doctorId: '', newVisit: '0', followUp: '0', currency: 'INR' });
  const [adminDoctors, setAdminDoctors] = useState<AdminDoctor[]>([]);
  const [adminSpecializations, setAdminSpecializations] = useState<AdminSpecialization[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [specializationAssignment, setSpecializationAssignment] = useState({ doctorId: '', specializationIds: [] as string[], primarySpecializationId: '' });
  const [sessionForm, setSessionForm] = useState({ date: localDate(), startTime: '09:00', endTime: '12:00', mode: 'TOKEN_SESSION', advanceCapacity: '20', walkInCapacity: '5', slotDurationMinutes: '15' });
  const [deskSearch, setDeskSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientForm, setPatientForm] = useState({ givenName: '', familyName: '', contactPhone: '', sex: 'UNKNOWN', dateOfBirth: '', ageEstimatedYears: '30' });
  const [deskDoctorId, setDeskDoctorId] = useState('');
  const [deskDate, setDeskDate] = useState(localDate());
  const [deskSessions, setDeskSessions] = useState<Session[]>([]);
  const [deskAllocationId, setDeskAllocationId] = useState('');
  const [deskVisit, setDeskVisit] = useState<'NEW_VISIT' | 'FOLLOW_UP'>('NEW_VISIT');

  async function loadBase() {
    setLoading(true); setError('');
    try {
      const me = await api<User>('/auth/me'); setUser(me);
      if (me.roles.includes('DOCTOR')) await loadDoctorQueue(localDate());
      if (me.roles.includes('RECEPTIONIST')) await Promise.all([loadDeskAppointments(localDate()), loadDoctors(false)]);
      if (me.roles.includes('ADMIN')) await Promise.all([loadAdmin(), loadDoctors(true)]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load the workspace.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadBase(); }, []);

  async function loadDoctors(adminView = false) {
    try {
      if (adminView) {
        const rows = await api<AdminDoctor[]>('/staff/admin/doctors');
        setDoctors(rows.filter((doctor) => doctor.onboardingStatus === 'APPROVED').map((doctor) => ({ id: doctor.id, name: doctor.name, qualifications: doctor.qualifications, fees: doctor.fees, specializations: doctor.specializations.map((item) => ({ name: item.name })) })));
      } else setDoctors(await api<Doctor[]>('/catalog/doctors'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load doctors.'); }
  }
  async function loadDoctorQueue(date = today) {
    setToday(date); setAppointments(await api<Appointment[]>(`/appointments/doctor/queue?date=${date}`));
  }
  async function loadDeskAppointments(date = today) {
    setToday(date); setAppointments(await api<Appointment[]>(`/staff/appointments?date=${date}`));
  }
  async function loadAdmin() {
    const [counts, pendingDoctors, doctorRows, specialtyRows, staffRows] = await Promise.all([api<typeof overview>('/staff/admin/overview'), api<PendingDoctor[]>('/staff/admin/doctors/pending'), api<AdminDoctor[]>('/staff/admin/doctors'), api<AdminSpecialization[]>('/staff/admin/specializations'), api<StaffUser[]>('/staff/admin/users')]);
    setOverview(counts); setPending(pendingDoctors); setAdminDoctors(doctorRows); setAdminSpecializations(specialtyRows); setStaffUsers(staffRows);
    setSpecializationAssignment((current) => {
      if (current.doctorId && doctorRows.some((doctor) => doctor.id === current.doctorId)) return current;
      const first = doctorRows[0];
      return first ? { doctorId: first.id, specializationIds: first.specializations.map((x) => x.id), primarySpecializationId: first.specializations.find((x) => x.primary)?.id ?? '' } : { doctorId: '', specializationIds: [], primarySpecializationId: '' };
    });
  }
  async function perform(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'The operation failed.'); }
    finally { setBusy(false); }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await api('/staff/doctor/sessions', { method: 'POST', body: JSON.stringify({ ...sessionForm, advanceCapacity: Number(sessionForm.advanceCapacity), walkInCapacity: Number(sessionForm.walkInCapacity), slotDurationMinutes: Number(sessionForm.slotDurationMinutes) }) });
      await loadDoctorQueue(sessionForm.date);
    }, 'Clinic session created. Availability is now available for booking.');
  }

  async function updateAppointment(item: Appointment, status: string) {
    await perform(async () => {
      await api(`/appointments/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (user?.roles.includes('DOCTOR')) await loadDoctorQueue(today); else await loadDeskAppointments(today);
    }, `Appointment status updated to ${status.replaceAll('_', ' ').toLowerCase()}.`);
  }

  async function searchDeskPatients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => { setPatients(await api<Patient[]>(`/staff/patients?search=${encodeURIComponent(deskSearch)}`)); }, 'Patient search complete.');
  }

  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const result = await api<Patient>('/staff/patients', { method: 'POST', body: JSON.stringify({ ...patientForm, ageEstimatedYears: patientForm.dateOfBirth ? undefined : Number(patientForm.ageEstimatedYears), dateOfBirth: patientForm.dateOfBirth || undefined }) });
      setSelectedPatient(result); setPatients([result]); setDeskSearch(result.contactPhone);
    }, 'Walk-in patient record created and selected.');
  }

  async function loadDeskAvailability(doctorId = deskDoctorId, date = deskDate) {
    setDeskDoctorId(doctorId); setDeskDate(date); setDeskSessions([]); setDeskAllocationId('');
    if (!doctorId || !date) return;
    await perform(async () => { setDeskSessions(await api<Session[]>(`/staff/availability?doctorId=${doctorId}&date=${date}`)); }, 'Availability refreshed.');
  }

  async function createDeskBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient) { setError('Search for or create a patient before booking.'); return; }
    if (!deskAllocationId) { setError('Select a capacity slot.'); return; }
    await perform(async () => {
      const result = await api<Appointment>('/staff/appointments', { method: 'POST', body: JSON.stringify({ patientId: selectedPatient.id, allocationId: deskAllocationId, visitKind: deskVisit }) });
      setNotice(`Walk-in/assisted booking created: ${result.bookingReference}`); await loadDeskAppointments(deskDate);
    }, 'Assisted booking saved.');
  }

  async function approveDoctor(id: string) {
    await perform(async () => { await api(`/staff/admin/doctors/${id}/approve`, { method: 'PATCH' }); await loadAdmin(); }, 'Doctor approved and made bookable.');
  }
  async function addSpecialty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => { await api('/staff/admin/specializations', { method: 'POST', body: JSON.stringify(specialtyForm) }); setSpecialtyForm({ name: '', code: '', description: '' }); await loadAdmin(); }, 'Specialty added to the public directory.');
  }
  function chooseAssignmentDoctor(doctorId: string) {
    const doctor = adminDoctors.find((item) => item.id === doctorId);
    setSpecializationAssignment({ doctorId, specializationIds: doctor?.specializations.map((item) => item.id) ?? [], primarySpecializationId: doctor?.specializations.find((item) => item.primary)?.id ?? '' });
  }
  async function saveDoctorSpecializations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!specializationAssignment.doctorId) { setError('Select a doctor first.'); return; }
    if (specializationAssignment.primarySpecializationId && !specializationAssignment.specializationIds.includes(specializationAssignment.primarySpecializationId)) { setError('The primary specialty must be selected in the assigned specialties.'); return; }
    await perform(async () => { await api(`/staff/admin/doctors/${specializationAssignment.doctorId}/specializations`, { method: 'PUT', body: JSON.stringify(specializationAssignment) }); await loadAdmin(); }, 'Doctor specializations updated.');
  }
  async function changeStaffRole(userId: string, role: 'ADMIN' | 'RECEPTIONIST', enabled: boolean) {
    await perform(async () => { await api(`/staff/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role, enabled }) }); await loadAdmin(); }, `Staff role ${enabled ? 'granted' : 'removed'}.`);
  }
  async function saveFees(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!feeForm.doctorId) { setError('Select a doctor first.'); return; }
    await perform(async () => { await api(`/staff/admin/doctors/${feeForm.doctorId}/fees`, { method: 'PATCH', body: JSON.stringify({ newVisitFeeMinor: Math.round(Number(feeForm.newVisit) * 100), followUpFeeMinor: Math.round(Number(feeForm.followUp) * 100), feeCurrency: feeForm.currency }) }); await Promise.all([loadAdmin(), loadDoctors(true)]); }, 'Consultation fees updated. Public fee display and future booking snapshots will use the new values.');
  }
  async function signOut() { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); window.location.href = '/'; }

  const isAdmin = user?.roles.includes('ADMIN') ?? false;
  const isDoctor = user?.roles.includes('DOCTOR') ?? false;
  const isReception = user?.roles.includes('RECEPTIONIST') ?? false;

  return <main className="app-shell subpage-shell">
<nav className="nav-bar page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<div className="nav-links">
<Link href="/#doctors">Public directory</Link>
{user?.roles.includes('ADMIN') && <Link href="/workspace/payments">Payment operations</Link>}
{user?.roles.includes('PATIENT') && <Link href="/appointments">My appointments</Link>}
</div>
<div className="nav-actions">
<span className="signed-in">{user?.email || 'Workspace'}</span>
<button className="button button-quiet" onClick={signOut}>Sign out</button>
</div>
</nav>
<section className="subpage-hero page-width">
<span className="eyebrow">SCHEDULA OPERATIONS</span>
<h1>Your care <em>workspace.</em></h1>
<p>Role-based tools for the people coordinating every visit.</p>
{user && <div className="role-pills">{user.roles.map((role) => <span key={role} className="role-pill">{role.replaceAll('_', ' ')}</span>)}</div>}
</section>
<div className="page-width page-content">
{notice && <div className="notice notice-success" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice('')}>×</button></div>}
{error && <div className="notice notice-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')}>×</button></div>}
{loading
  ? <div className="empty-state"><div className="loader"/><p>Opening your workspace…</p></div>
  : !user
    ? <div className="empty-state"><h2>Sign in to access your workspace.</h2><p>This area is restricted to authorized clinic users.</p><Link href="/" className="button button-terra">Go to sign in ↗</Link></div>
    : user.roles.includes('PATIENT') && !isDoctor && !isReception && !isAdmin
      ? <div className="empty-state"><h2>Your patient account is ready.</h2><p>View, cancel, or reschedule your upcoming visits.</p><Link className="button button-terra" href="/appointments">My appointments ↗</Link></div>
      : <>
{isDoctor && <>
<div className="workspace-section-head">
<div><span className="eyebrow">DOCTOR PORTAL</span><h2>Today&apos;s queue</h2><p>Only your own appointments are shown here.</p></div>
<label className="field-label compact-label">Clinic date<input type="date" value={today} onChange={(e) => void loadDoctorQueue(e.target.value)} /></label>
</div>
<div className="queue-list">
{appointments.length === 0
  ? <div className="empty-inline"><span>◷</span><p>No appointments for this date.</p></div>
  : appointments.map((item) =>
<article className="queue-row" key={item.id}>
<div className="queue-token">{item.tokenNumber ?? '·'}</div>
<div className="queue-detail">
<h3>{item.patient?.givenName} {item.patient?.familyName}</h3>
<p>{item.patient?.contactPhone} · {item.bookingReference}</p>
<span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span>
</div>
<div className="queue-actions">
{item.status === 'BOOKED' && <button disabled={busy} className="button button-outline" onClick={() => void updateAppointment(item, 'CHECKED_IN')}>Check in</button>}
{item.status === 'CHECKED_IN' && <button disabled={busy} className="button button-terra" onClick={() => void updateAppointment(item, 'IN_CONSULT')}>Start consult</button>}
{item.status === 'IN_CONSULT' && <button disabled={busy} className="button button-dark" onClick={() => void updateAppointment(item, 'COMPLETED')}>Complete</button>}
{['BOOKED', 'CHECKED_IN'].includes(item.status) && <button disabled={busy} className="button button-quiet" onClick={() => void updateAppointment(item, 'NO_SHOW')}>Mark no-show</button>}
</div>
</article>)}
</div>
<section className="panel-card schedule-panel">
<div><span className="eyebrow">PUBLISH AVAILABILITY</span><h2>Create a clinic session</h2><p>Token sessions create a queue. Timed sessions create individual time slots and capacity pools.</p></div>
<form className="form-grid" onSubmit={createSession}>
<label className="field-label">Date<input type="date" min={localDate()} required value={sessionForm.date} onChange={(e) => setSessionForm({ ...sessionForm, date: e.target.value })} /></label>
<label className="field-label">Start<input type="time" required value={sessionForm.startTime} onChange={(e) => setSessionForm({ ...sessionForm, startTime: e.target.value })} /></label>
<label className="field-label">End<input type="time" required value={sessionForm.endTime} onChange={(e) => setSessionForm({ ...sessionForm, endTime: e.target.value })} /></label>
<label className="field-label">Scheduling mode<select value={sessionForm.mode} onChange={(e) => setSessionForm({ ...sessionForm, mode: e.target.value })}>
<option value="TOKEN_SESSION">Token queue</option>
<option value="TIMED_SESSION">Timed slots</option>
</select></label>
<label className="field-label">Advance capacity<input type="number" min="0" max="500" required value={sessionForm.advanceCapacity} onChange={(e) => setSessionForm({ ...sessionForm, advanceCapacity: e.target.value })} /></label>
<label className="field-label">Walk-in capacity<input type="number" min="0" max="500" required value={sessionForm.walkInCapacity} onChange={(e) => setSessionForm({ ...sessionForm, walkInCapacity: e.target.value })} /></label>
{sessionForm.mode === 'TIMED_SESSION' && <label className="field-label">Slot duration (minutes)<input type="number" min="5" max="240" step="5" required value={sessionForm.slotDurationMinutes} onChange={(e) => setSessionForm({ ...sessionForm, slotDurationMinutes: e.target.value })} /></label>}
<div className="form-submit"><button className="button button-terra" disabled={busy}>Create session ↗</button></div>
</form>
</section>
</>}

{isReception && <>
<section className="panel-card">
<div className="workspace-section-head">
<div><span className="eyebrow">RECEPTION DESK</span><h2>Find or register a patient</h2><p>Search before creating a new record to reduce duplicates.</p></div>
</div>
<form className="search-controls staff-search" onSubmit={searchDeskPatients}>
<label className="search-input"><span>⌕</span><input value={deskSearch} onChange={(e) => setDeskSearch(e.target.value)} placeholder="Name, patient code, phone, or file number" required /></label>
<button className="button button-dark" disabled={busy}>Search</button>
</form>
<div className="patient-search-results">
{patients.map((patient) =>
<button type="button" className={`patient-result ${selectedPatient?.id === patient.id ? 'selected' : ''}`} key={patient.id} onClick={() => setSelectedPatient(patient)}>
<b>{patient.givenName} {patient.familyName}</b>
<span>{patient.patientCode} · {patient.contactPhone}</span>
<small>{patient.sex} {patient.dateOfBirth ? `· DOB ${patient.dateOfBirth.slice(0, 10)}` : patient.ageEstimatedYears ? `· Age ${patient.ageEstimatedYears}` : ''}</small>
</button>)}
</div>
<details className="create-patient-details">
<summary>Register a new walk-in patient</summary>
<form className="form-grid" onSubmit={createPatient}>
<label className="field-label">First name<input required value={patientForm.givenName} onChange={(e) => setPatientForm({ ...patientForm, givenName: e.target.value })} /></label>
<label className="field-label">Last name<input value={patientForm.familyName} onChange={(e) => setPatientForm({ ...patientForm, familyName: e.target.value })} /></label>
<label className="field-label">Phone<input required value={patientForm.contactPhone} onChange={(e) => setPatientForm({ ...patientForm, contactPhone: e.target.value })} /></label>
<label className="field-label">Sex<select value={patientForm.sex} onChange={(e) => setPatientForm({ ...patientForm, sex: e.target.value })}>
<option>UNKNOWN</option><option>FEMALE</option><option>MALE</option><option>OTHER</option>
</select></label>
<label className="field-label">Date of birth (optional)<input type="date" value={patientForm.dateOfBirth} onChange={(e) => setPatientForm({ ...patientForm, dateOfBirth: e.target.value })} /></label>
{!patientForm.dateOfBirth && <label className="field-label">Estimated age<input type="number" min="0" max="130" required value={patientForm.ageEstimatedYears} onChange={(e) => setPatientForm({ ...patientForm, ageEstimatedYears: e.target.value })} /></label>}
<div className="form-submit"><button className="button button-outline" disabled={busy}>Create patient record</button></div>
</form>
</details>
{selectedPatient && <p className="selected-patient-note">Selected: <b>{selectedPatient.givenName} {selectedPatient.familyName}</b> ({selectedPatient.patientCode})</p>}
</section>
<section className="panel-card">
<span className="eyebrow">ASSISTED BOOKING</span>
<h2>Book for the selected patient</h2>
<p>Choose a verified doctor, date, and an available advance or reserved walk-in capacity pool.</p>
<form className="form-grid" onSubmit={createDeskBooking}>
<label className="field-label">Doctor<select value={deskDoctorId} required onChange={(e) => { setDeskDoctorId(e.target.value); void loadDeskAvailability(e.target.value, deskDate); }}>
<option value="">Choose a verified doctor</option>
{doctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.name}</option>)}
</select></label>
<label className="field-label">Date<input type="date" min={localDate()} value={deskDate} onChange={(e) => { setDeskDate(e.target.value); void loadDeskAvailability(deskDoctorId, e.target.value); }} /></label>
<label className="field-label">Visit type<select value={deskVisit} onChange={(e) => setDeskVisit(e.target.value as 'NEW_VISIT' | 'FOLLOW_UP')}>
<option value="NEW_VISIT">New visit</option>
<option value="FOLLOW_UP">Follow-up</option>
</select></label>
<label className="field-label">Available capacity<select required value={deskAllocationId} onChange={(e) => setDeskAllocationId(e.target.value)}>
<option value="">Choose a slot / pool</option>
{deskSessions.flatMap((session) => session.allocations.filter((a) => a.bookable && a.availableCount > 0).map((a) =>
<option key={a.id} value={a.id}>{session.startTime.slice(0, 5)} · {a.startTime ? `${a.startTime}–${a.endTime}` : 'Token session'} · {a.poolType.replaceAll('_', ' ')} · {a.availableCount} left</option>))}
</select></label>
<div className="form-submit"><button disabled={busy || !selectedPatient} className="button button-terra">Create assisted booking ↗</button></div>
</form>
<button className="button button-quiet" onClick={() => void loadDeskAvailability()} disabled={!deskDoctorId || busy}>Refresh availability</button>
</section>
</>}

{isReception && <section className="workspace-section">
<div className="workspace-section-head">
<div><span className="eyebrow">CLINIC FLOW</span><h2>Appointments for the day</h2></div>
<label className="field-label compact-label">Date<input type="date" value={today} onChange={(e) => void loadDeskAppointments(e.target.value)} /></label>
</div>
<div className="queue-list">
{appointments.length === 0
  ? <div className="empty-inline"><span>◷</span><p>No appointments on this date.</p></div>
  : appointments.map((item) =>
<article className="queue-row" key={item.id}>
<div className="queue-token">{item.tokenNumber ?? '·'}</div>
<div className="queue-detail">
<h3>{item.patient?.givenName} {item.patient?.familyName}</h3>
<p>{item.doctor?.profile?.displayName} · {item.patient?.contactPhone}</p>
<span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span>
</div>
<div className="queue-actions">
{item.status === 'BOOKED' && <button className="button button-outline" disabled={busy} onClick={() => void updateAppointment(item, 'CHECKED_IN')}>Check in</button>}
{item.status === 'CHECKED_IN' && <button className="button button-terra" disabled={busy} onClick={() => void updateAppointment(item, 'IN_CONSULT')}>Start consult</button>}
{item.status === 'IN_CONSULT' && <button className="button button-dark" disabled={busy} onClick={() => void updateAppointment(item, 'COMPLETED')}>Complete</button>}
</div>
</article>)}
</div>
</section>}

{isAdmin && <>
<section className="metric-grid">
{[{ label: 'Doctors', value: overview?.doctors ?? '—', icon: '✳' }, { label: 'Patients', value: overview?.patients ?? '—', icon: '◉' }, { label: 'Appointments', value: overview?.appointments ?? '—', icon: '◷' }, { label: 'Pending verification', value: overview?.pendingDoctors ?? '—', icon: '⌁' }].map((metric) =>
<article className="metric-card" key={metric.label}><span>{metric.icon}</span><small>{metric.label}</small><strong>{metric.value}</strong></article>)}
</section>
<section className="panel-card">
<span className="eyebrow">DOCTOR ONBOARDING</span>
<h2>Verification queue</h2>
<p>Approve a doctor only after checking the medical registration details.</p>
{pending.length === 0
  ? <div className="empty-inline"><span>✓</span><p>No doctor profiles are waiting for review.</p></div>
  : pending.map((doctor) =>
<div className="pending-doctor" key={doctor.id}>
<div>
<h3>{doctor.profile?.displayName}</h3>
<p>{doctor.profile?.qualifications} · {doctor.user?.email}</p>
<small>{doctor.medicalCouncil} · Registration {doctor.registrationNumber}</small>
</div>
<button className="button button-terra" disabled={busy} onClick={() => void approveDoctor(doctor.id)}>Approve doctor ↗</button>
</div>)}
</section>
<div className="admin-grid">
<section className="panel-card">
<span className="eyebrow">PUBLIC DIRECTORY</span>
<h2>Add a specialty</h2>
<form className="stack-form" onSubmit={addSpecialty}>
<label className="field-label">Specialty name<input required value={specialtyForm.name} onChange={(e) => setSpecialtyForm({ ...specialtyForm, name: e.target.value })} /></label>
<label className="field-label">Code<input required value={specialtyForm.code} onChange={(e) => setSpecialtyForm({ ...specialtyForm, code: e.target.value })} placeholder="CARDIOLOGY" /></label>
<label className="field-label">Description<textarea value={specialtyForm.description} onChange={(e) => setSpecialtyForm({ ...specialtyForm, description: e.target.value })} rows={3} /></label>
<button className="button button-dark" disabled={busy}>Add specialty</button>
</form>
</section>
<section className="panel-card">
<span className="eyebrow">CONSULTATION FEES</span>
<h2>Update doctor fees</h2>
<p>Amounts are entered in rupees and stored as integer minor units.</p>
<form className="stack-form" onSubmit={saveFees}>
<label className="field-label">Verified doctor<select required value={feeForm.doctorId} onChange={(e) => setFeeForm({ ...feeForm, doctorId: e.target.value })}>
<option value="">Choose doctor</option>
{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
</select></label>
<div className="two-col">
<label className="field-label">New visit (₹)<input type="number" min="0" step="0.01" required value={feeForm.newVisit} onChange={(e) => setFeeForm({ ...feeForm, newVisit: e.target.value })} /></label>
<label className="field-label">Follow-up (₹)<input type="number" min="0" step="0.01" required value={feeForm.followUp} onChange={(e) => setFeeForm({ ...feeForm, followUp: e.target.value })} /></label>
</div>
<label className="field-label">Currency<select value={feeForm.currency} onChange={(e) => setFeeForm({ ...feeForm, currency: e.target.value })}>
<option value="INR">INR · Indian rupee</option>
<option value="USD">USD · US dollar</option>
<option value="GBP">GBP · Pound sterling</option>
</select></label>
{feeForm.doctorId && <p className="selected-patient-note">Current fee: {money(doctors.find((d) => d.id === feeForm.doctorId)?.fees.newVisitMinor, doctors.find((d) => d.id === feeForm.doctorId)?.fees.currency)}</p>}
<button className="button button-terra" disabled={busy}>Save fees</button>
</form>
</section>
</div>
<div className="admin-grid">
<section className="panel-card">
<span className="eyebrow">DOCTOR DIRECTORY</span>
<h2>Assign specialties</h2>
<p>Set the specialties used by public doctor search. Select one primary specialty when applicable.</p>
<form className="stack-form" onSubmit={saveDoctorSpecializations}>
<label className="field-label">Doctor<select required value={specializationAssignment.doctorId} onChange={(e) => chooseAssignmentDoctor(e.target.value)}>
<option value="">Choose doctor</option>
{adminDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.onboardingStatus.replaceAll('_', ' ')}</option>)}
</select></label>
<label className="field-label">Assigned specialties<select multiple size={Math.min(6, Math.max(3, adminSpecializations.length))} value={specializationAssignment.specializationIds} onChange={(e) => { const ids = Array.from(e.target.selectedOptions, (option) => option.value); setSpecializationAssignment((old) => ({ ...old, specializationIds: ids, primarySpecializationId: ids.includes(old.primarySpecializationId) ? old.primarySpecializationId : '' })); }}>
<optgroup label="Available specialties">
{adminSpecializations.filter((specialty) => specialty.isActive).map((specialty) => <option key={specialty.id} value={specialty.id}>{specialty.name}</option>)}
</optgroup>
</select>
<small>Use Ctrl (Windows) or Command (Mac) to select multiple items.</small>
</label>
<label className="field-label">Primary specialty<select value={specializationAssignment.primarySpecializationId} onChange={(e) => setSpecializationAssignment({ ...specializationAssignment, primarySpecializationId: e.target.value })}>
<option value="">No primary specialty</option>
{adminSpecializations.filter((specialty) => specializationAssignment.specializationIds.includes(specialty.id)).map((specialty) => <option key={specialty.id} value={specialty.id}>{specialty.name}</option>)}
</select></label>
<button className="button button-dark" disabled={busy || !specializationAssignment.doctorId}>Save specialty assignments</button>
</form>
</section>
<section className="panel-card">
<span className="eyebrow">STAFF ACCESS</span>
<h2>Manage staff roles</h2>
<p>Grant or remove receptionist and administrator privileges. Doctor privileges are created with a doctor profile.</p>
<div className="staff-role-list">
{staffUsers.map((account) =>
<article className="staff-role-row" key={account.id}>
<div><b>{account.email || account.phone || 'Account'}</b><small>{account.status.toLowerCase().replaceAll('_', ' ')} · {account.roles.join(', ')}</small></div>
<div className="staff-role-toggles">
{(['RECEPTIONIST', 'ADMIN'] as const).map((role) =>
<label key={role}><input type="checkbox" checked={account.roles.includes(role)} disabled={busy || (account.id === user?.id && role === 'ADMIN')} onChange={(e) => void changeStaffRole(account.id, role, e.target.checked)} />{role === 'ADMIN' ? 'Admin' : 'Reception'}</label>)}
</div>
</article>)}
{staffUsers.length === 0 && <p className="muted">No accounts found yet.</p>}
</div>
</section>
</div>
</>}
{!isAdmin && !isDoctor && !isReception && <div className="empty-state"><h2>No operations role found.</h2><p>Ask an administrator to assign the appropriate clinic role.</p></div>}
</>}
</div>
<footer className="footer page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<span>Care, coordinated with clarity.</span>
<Link href="/#doctors">Public directory ↗</Link>
<small>© {new Date().getFullYear()} Schedula</small>
</footer>
</main>;
}
