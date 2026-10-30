'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, localDate, money } from '../lib/api';

type User = { id: string; email: string | null; roles: string[]; patientId: string | null; doctor?: { id: string; onboardingStatus: string } | null };
type Specialization = { id: string; name: string; code: string };
type Doctor = { id: string; name: string; qualifications: string; bio: string; yearsOfExperience: number; fees: { newVisitMinor: number; followUpMinor: number; currency: string }; specializations: Array<{ id: string; name: string; primary?: boolean }> };
type Allocation = { id: string; poolType: string; timedSlotId: string | null; slotStartTime: string | null; slotEndTime: string | null; availableCount: number; bookable: boolean };
type Session = { id: string; date: string; startTime: string; endTime: string; mode: string; allocations: Allocation[] };
type Dependent = { id: string; patientCode: string; givenName: string; familyName: string | null; contactPhone: string; dateOfBirth: string | null; ageEstimatedYears: number | null };

export default function HomePage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specializations, setSpecializations] = useState<Specialization[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [specializationId, setSpecializationId] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [date, setDate] = useState(localDate());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedAllocationId, setSelectedAllocationId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'PAY_AT_COUNTER' | 'PAY_ONLINE'>('PAY_AT_COUNTER');
  const [visitKind, setVisitKind] = useState<'NEW_VISIT' | 'FOLLOW_UP'>('NEW_VISIT');
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [bookingPatientId, setBookingPatientId] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'doctor'>('login');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authForm, setAuthForm] = useState({ email: '', password: '', givenName: '', familyName: '', contactPhone: '', dateOfBirth: '', sex: 'UNKNOWN', displayName: '', qualifications: '', medicalCouncil: '', registrationNumber: '', phone: '' });

  async function loadCatalog(nextSearch = search, nextSpec = specializationId) {
    setLoading(true); setError('');
    try {
      const [doctorRows, specRows] = await Promise.all([
        api<Doctor[]>(`/catalog/doctors?search=${encodeURIComponent(nextSearch)}${nextSpec ? `&specializationId=${encodeURIComponent(nextSpec)}` : ''}`),
        api<Specialization[]>('/catalog/specializations'),
      ]);
      setDoctors(doctorRows); setSpecializations(specRows);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load doctors.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void loadCatalog('', '');
    api<User>('/auth/me').then(setUser).catch(() => setUser(null));
  }, []);

  async function openAvailability(doctor: Doctor) {
    setSelectedDoctor(doctor); setSessions([]); setSelectedAllocationId(''); setPaymentMethod('PAY_AT_COUNTER'); setNotice(''); setError(''); setDate(localDate());
    if (user?.roles.includes('PATIENT') && user.patientId) {
      setBookingPatientId(user.patientId);
      api<Dependent[]>('/patients/me/dependents').then(setDependents).catch(() => setDependents([]));
    } else { setDependents([]); setBookingPatientId(''); }
    try { setSessions(await api<Session[]>(`/catalog/doctors/${doctor.id}/availability?date=${localDate()}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load availability.'); }
  }

  async function changeDate(value: string) {
    setDate(value); setSessions([]); setSelectedAllocationId(''); setError('');
    if (!selectedDoctor || !value) return;
    try { setSessions(await api<Session[]>(`/catalog/doctors/${selectedDoctor.id}/availability?date=${value}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load availability.'); }
  }

  async function reserve() {
    if (!selectedAllocationId) { setError('Select an appointment time first.'); return; }
    if (!user) { setAuthMode('login'); setAuthOpen(true); setNotice('Sign in or create a patient account before booking.'); return; }
    if (!user.roles.includes('PATIENT') || !user.patientId) { setError('Please sign in with a patient account to book an appointment.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const appointment = await api<{ id: string; bookingReference: string; paymentMethod: string }>('/appointments', {
        method: 'POST',
        body: JSON.stringify({ allocationId: selectedAllocationId, visitKind, paymentMethod, patientId: bookingPatientId || user.patientId }),
      });
      window.location.assign(`/appointments?booked=${encodeURIComponent(appointment.bookingReference)}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Booking failed. Please check the message and try another slot.'); }
    finally { setBusy(false); }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const payload = authMode === 'register'
      ? { email: authForm.email, password: authForm.password, givenName: authForm.givenName, familyName: authForm.familyName, contactPhone: authForm.contactPhone, dateOfBirth: authForm.dateOfBirth, sex: authForm.sex }
      : authMode === 'doctor'
        ? { email: authForm.email, password: authForm.password, displayName: authForm.displayName, qualifications: authForm.qualifications, medicalCouncil: authForm.medicalCouncil, registrationNumber: authForm.registrationNumber, phone: authForm.phone }
        : { email: authForm.email, password: authForm.password };
    try {
      const result = await api<{ user: User; notice?: string }>(authMode === 'register' ? '/auth/register' : authMode === 'doctor' ? '/auth/register-doctor' : '/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      setUser(result.user); setAuthOpen(false); setNotice(result.notice ?? `Signed in as ${result.user.email}.`);
      if (result.user.roles.includes('PATIENT') && result.user.patientId) { setBookingPatientId(result.user.patientId); api<Dependent[]>('/patients/me/dependents').then(setDependents).catch(() => setDependents([])); }
      if (selectedDoctor && result.user.roles.includes('PATIENT')) await changeDate(date);
    } catch (e) { setError(e instanceof Error ? e.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try { await api('/auth/logout', { method: 'POST' }); } finally { setUser(null); setNotice('You are signed out.'); }
  }

  const availableCount = useMemo(() => sessions.reduce((sum, session) => sum + session.allocations.filter((a) => a.bookable).length, 0), [sessions]);
  const selectedAllocation = sessions.flatMap((session) => session.allocations).find((allocation) => allocation.id === selectedAllocationId);
  void availableCount;

  return <main className="app-shell">
<nav className="nav-bar page-width">
<Link href="/" className="brand" aria-label="Schedula home">
<span className="brand-mark">S</span>
<span>Schedula<span className="brand-dot">.</span></span>
</Link>
<div className="nav-links">
<a href="#specialties">Specialties</a>
<a href="#how-it-works">How it works</a>
{user?.roles.includes('PATIENT') && <>
<Link href="/appointments">My appointments</Link>
<Link href="/payments">Payments</Link>
<Link href="/profile">My profile</Link>
</>}
{user && !user.roles.includes('PATIENT') && <Link href="/workspace">Workspace</Link>}
</div>
<div className="nav-actions">
{user ? <>
<span className="signed-in">{user.email}</span>
<button className="button button-quiet" onClick={signOut}>Sign out</button>
</> : <button className="button button-dark" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}>Sign in <span aria-hidden="true">↗</span></button>}
</div>
</nav>
<section className="hero page-width">
<div className="hero-copy">
<div className="eyebrow"><span className="eyebrow-line" /> CLINIC CARE, MADE CLEAR</div>
<h1>Good care begins<br />with <em>good timing.</em></h1>
<p className="hero-intro">Find a verified doctor, see genuine availability, and book a visit without the back-and-forth.</p>
<div className="hero-actions">
<a className="button button-terra" href="#doctors">Find a doctor <span aria-hidden="true">↘</span></a>
<span className="hero-footnote"><span className="online-dot" /> Real appointment availability</span>
</div>
<div className="hero-proof">
<div className="avatar-stack" aria-hidden="true"><i>+</i><i>✳</i><i>○</i></div>
<span>One clear place for your next visit</span>
</div>
</div>
<div className="hero-visual" aria-label="Abstract layered illustration representing calm, organized healthcare">
<div className="visual-orbit orbit-a"/>
<div className="visual-orbit orbit-b"/>
<div className="visual-ring ring-a"/>
<div className="visual-ring ring-b"/>
<div className="visual-core">
<span className="core-cross">+</span>
<span className="core-caption">CARE, IN SYNC</span>
</div>
<div className="floating-note note-top">
<span className="note-icon">✓</span>
<span><b>Verified profiles</b><small>Doctor onboarding reviewed</small></span>
</div>
<div className="floating-note note-bottom">
<span className="note-clock">◷</span>
<span><b>Choose your time</b><small>Book what works for you</small></span>
</div>
<div className="visual-index">01 / 04 <span>● ○ ○ ○</span></div>
</div>
</section>
<section className="search-panel page-width" id="doctors">
<div className="search-title">
<span className="eyebrow">THE RIGHT SPECIALIST</span>
<h2>Care that fits your needs.</h2>
</div>
<form className="search-controls" onSubmit={(e) => { e.preventDefault(); void loadCatalog(search, specializationId); }}>
<label className="search-input">
<span>⌕</span>
<input aria-label="Search doctors or specialties" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Doctor name or specialty" />
</label>
<label className="select-wrap">
<span className="sr-only">Specialty filter</span>
<select value={specializationId} onChange={(e) => { setSpecializationId(e.target.value); void loadCatalog(search, e.target.value); }}>
<option value="">All specialties</option>
{specializations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
</select>
</label>
<button type="submit" className="button button-dark">Search <span aria-hidden="true">→</span></button>
</form>
</section>

{notice && <div className="page-width notice notice-success" role="status">
<span>✓</span><p>{notice}</p><button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button>
</div>}
{error && <div className="page-width notice notice-error" role="alert">
<span>!</span><p>{error}</p><button onClick={() => setError('')} aria-label="Dismiss error">×</button>
</div>}

<section className="doctor-section page-width">
<div className="section-head">
<div>
<span className="eyebrow">MEET YOUR DOCTOR</span>
<h2>Thoughtful care, trusted people.</h2>
</div>
<span className="result-count">{loading ? 'Loading…' : `${doctors.length} verified ${doctors.length === 1 ? 'doctor' : 'doctors'}`}</span>
</div>
{loading ? <div className="empty-state"><div className="loader"/><p>Finding available doctors…</p></div>
: doctors.length === 0 ? <div className="empty-state"><div className="empty-symbol">⌕</div><h3>No matching doctors yet</h3><p>Try another name or specialty. Only verified, bookable profiles appear here.</p></div>
: <div className="doctor-grid">{doctors.map((doctor, index) =>
<article className="doctor-card" key={doctor.id}>
<div className={`doctor-art doctor-art-${index % 4}`}>
<span className="doctor-number">DOC / {String(index + 1).padStart(2, '0')}</span>
<div className="portrait-initials">{doctor.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
<span className="verified-pill">✓ Verified</span>
</div>
<div className="doctor-card-body">
<div className="doctor-specialties">{doctor.specializations.slice(0, 2).map((item) => <span key={item.id}>{item.name}</span>)}</div>
<h3>{doctor.name}</h3>
<p className="doctor-qualifications">{doctor.qualifications}</p>
<p className="doctor-bio">{doctor.bio || `${doctor.yearsOfExperience} years of experience in patient care.`}</p>
<div className="doctor-bottom">
<div><small>NEW VISIT</small><strong>{money(doctor.fees.newVisitMinor, doctor.fees.currency)}</strong></div>
<button className="button button-outline" onClick={() => void openAvailability(doctor)}>View times <span aria-hidden="true">↗</span></button>
</div>
</div>
</article>)}</div>}
</section>

<section className="specialty-strip" id="specialties">
<div className="page-width specialty-inner">
<div>
<span className="eyebrow">START WITH A SPECIALTY</span>
<h2>What brings you here?</h2>
</div>
<div className="specialty-chips">
{specializations.slice(0, 8).map((item, i) =>
<button className="specialty-chip" key={item.id} onClick={() => { setSearch(''); setSpecializationId(item.id); void loadCatalog('', item.id); document.getElementById('doctors')?.scrollIntoView({ behavior: 'smooth' }); }}>
<span>{(['✳', '◌', '⌁', '✣', '◉', '✧', '⊙', '✺'] as string[])[i % 8]}</span>{item.name}<b>↗</b>
</button>)}
{specializations.length === 0 && <p className="muted">Specialties added by your clinic will appear here.</p>}
</div>
</div>
</section>

<section className="how-section page-width" id="how-it-works">
<div className="how-intro">
<span className="eyebrow">A BETTER ROUTINE</span>
<h2>Three steps.<br /><em>More peace of mind.</em></h2>
<p>Less time coordinating. More time focusing on what matters.</p>
</div>
<div className="steps-grid">
<article className="step-card">
<span className="step-index">01</span>
<div className="step-icon">⌕</div>
<h3>Find your fit</h3>
<p>Browse verified doctor profiles, specialties, and consultation fees before you decide.</p>
<span className="step-arrow">↘</span>
</article>
<article className="step-card step-featured">
<span className="step-index">02</span>
<div className="step-icon">◷</div>
<h3>Choose a time</h3>
<p>Check live availability and reserve an appointment in the slot that suits you.</p>
<span className="step-arrow">↘</span>
</article>
<article className="step-card">
<span className="step-index">03</span>
<div className="step-icon">✓</div>
<h3>You&apos;re all set</h3>
<p>Keep your reference, visit details, and appointment updates together in one place.</p>
<span className="step-arrow">↘</span>
</article>
</div>
</section>

<section className="bottom-cta page-width">
<div>
<span className="eyebrow">YOUR NEXT STEP</span>
<h2>Make room for better care.</h2>
<p>Start with a verified doctor and a time that works.</p>
</div>
<a className="button button-paper" href="#doctors">Explore doctors <span aria-hidden="true">↗</span></a>
<div className="cta-ornament" aria-hidden="true">S<span>.</span></div>
</section>

<footer className="footer page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<span>Care, coordinated with clarity.</span>
<div><a href="#how-it-works">How it works</a><a href="#doctors">Find a doctor</a></div>
<small>© {new Date().getFullYear()} Schedula · Appointment coordination</small>
</footer>

{selectedDoctor && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedDoctor(null); }}>
<section className="modal availability-modal" role="dialog" aria-modal="true" aria-labelledby="availability-title">
<button className="modal-close" onClick={() => setSelectedDoctor(null)} aria-label="Close">×</button>
<span className="eyebrow">BOOK A VISIT</span>
<h2 id="availability-title">{selectedDoctor.name}</h2>
<p className="modal-subtitle">{selectedDoctor.specializations.map((item) => item.name).join(' · ') || selectedDoctor.qualifications}</p>
<div className="booking-summary">
<span>New visit <b>{money(selectedDoctor.fees.newVisitMinor, selectedDoctor.fees.currency)}</b></span>
<span>Follow-up <b>{money(selectedDoctor.fees.followUpMinor, selectedDoctor.fees.currency)}</b></span>
</div>
{user?.roles.includes('PATIENT') && user.patientId && <label className="field-label">Booking for
<select value={bookingPatientId || user.patientId} onChange={(e) => setBookingPatientId(e.target.value)}>
<option value={user.patientId}>Myself</option>
{dependents.map((dependent) => <option key={dependent.id} value={dependent.id}>{dependent.givenName} {dependent.familyName || ''} · {dependent.patientCode}</option>)}
</select>
</label>}
<label className="field-label">Choose a date<input type="date" min={localDate()} value={date} onChange={(e) => void changeDate(e.target.value)} /></label>
<div className="visit-toggle" role="group" aria-label="Visit type">
<button className={visitKind === 'NEW_VISIT' ? 'active' : ''} onClick={() => setVisitKind('NEW_VISIT')}>New visit</button>
<button className={visitKind === 'FOLLOW_UP' ? 'active' : ''} onClick={() => setVisitKind('FOLLOW_UP')}>Follow-up</button>
</div>
<label className="field-label payment-choice-label">Payment option
<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'PAY_AT_COUNTER' | 'PAY_ONLINE')}>
<option value="PAY_AT_COUNTER">Pay on counter</option>
<option value="PAY_ONLINE">Pay online (Razorpay)</option>
</select>
<small>{paymentMethod === 'PAY_AT_COUNTER' ? 'Reserve now and pay at the clinic.' : 'Reserve now, then complete secure online checkout.'}</small>
</label>
<div className="availability-list">
{sessions.length === 0
  ? <div className="empty-inline"><span>◷</span><p>No advance-booking slots found for this date. Choose another date.</p></div>
  : sessions.map((session) =>
<div className="session-group" key={session.id}>
<div className="session-heading">
<b>{session.startTime.slice(0, 5)}–{session.endTime.slice(0, 5)}</b>
<span>{session.mode === 'TOKEN_SESSION' ? 'Token queue' : 'Timed appointments'}</span>
</div>
<div className="allocation-list">
{session.allocations.filter((a) => a.bookable && a.poolType === 'ADVANCE_BOOKING').map((allocation) =>
<button type="button" key={allocation.id} className="allocation-button" aria-pressed={selectedAllocationId === allocation.id} onClick={() => { setSelectedAllocationId(allocation.id); setError(''); }}>
<span>{allocation.slotStartTime ? `${allocation.slotStartTime.slice(0, 5)}–${allocation.slotEndTime?.slice(0, 5)}` : 'Next available token'}</span>
<small>{allocation.availableCount} left</small>
<b>{selectedAllocationId === allocation.id ? 'Selected ✓' : 'Select time'}</b>
</button>)}
</div>
</div>)}
</div>
{error && <div className="notice notice-error booking-inline-error" role="alert"><span>!</span><p>{error}</p></div>}
{selectedAllocation && <div className="selected-booking-panel">
<p>Selected time: <strong>{selectedAllocation.slotStartTime ? `${selectedAllocation.slotStartTime.slice(0, 5)}–${selectedAllocation.slotEndTime?.slice(0, 5)}` : 'Next available token'}</strong></p>
<button className="button button-terra button-full" disabled={busy} onClick={() => void reserve()}>{busy ? 'Confirming appointment…' : 'Confirm appointment'}</button>
</div>}
<p className="fine-print">Your appointment is added to My Appointments after confirmation. Online payments are completed separately through secure Razorpay checkout.</p>
</section>
</div>}

{authOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}>
<section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
<button className="modal-close" onClick={() => setAuthOpen(false)} aria-label="Close">×</button>
<span className="eyebrow">WELCOME TO SCHEDULA</span>
<h2 id="auth-title">{authMode === 'login' ? 'Good to see you.' : authMode === 'doctor' ? 'Join as a doctor.' : 'Let\'s get you started.'}</h2>
<p className="modal-subtitle">{authMode === 'doctor' ? 'Doctor profiles are reviewed before they can accept bookings.' : 'Your appointments, together in one clear place.'}</p>
<form className="auth-form" onSubmit={submitAuth}>
<label className="field-label">Email<input type="email" autoComplete="email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} /></label>
<label className="field-label">Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={10} required value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} /><small>Use at least 10 characters.</small></label>
{authMode === 'register' && <>
<div className="two-col">
<label className="field-label">First name<input required value={authForm.givenName} onChange={(e) => setAuthForm({ ...authForm, givenName: e.target.value })} /></label>
<label className="field-label">Last name<input value={authForm.familyName} onChange={(e) => setAuthForm({ ...authForm, familyName: e.target.value })} /></label>
</div>
<label className="field-label">Phone<input type="tel" required value={authForm.contactPhone} onChange={(e) => setAuthForm({ ...authForm, contactPhone: e.target.value })} /></label>
<div className="two-col">
<label className="field-label">Date of birth<input type="date" required max={localDate()} value={authForm.dateOfBirth} onChange={(e) => setAuthForm({ ...authForm, dateOfBirth: e.target.value })} /></label>
<label className="field-label">Sex<select value={authForm.sex} onChange={(e) => setAuthForm({ ...authForm, sex: e.target.value })}>
<option value="UNKNOWN">Prefer not to say</option>
<option value="FEMALE">Female</option>
<option value="MALE">Male</option>
<option value="OTHER">Other</option>
</select></label>
</div>
</>}
{authMode === 'doctor' && <>
<label className="field-label">Phone<input type="tel" required value={authForm.phone} onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })} /></label>
<label className="field-label">Display name<input required value={authForm.displayName} onChange={(e) => setAuthForm({ ...authForm, displayName: e.target.value })} /></label>
<label className="field-label">Qualifications<input required value={authForm.qualifications} onChange={(e) => setAuthForm({ ...authForm, qualifications: e.target.value })} placeholder="e.g. MBBS, MD" /></label>
<div className="two-col">
<label className="field-label">Medical council<input required value={authForm.medicalCouncil} onChange={(e) => setAuthForm({ ...authForm, medicalCouncil: e.target.value })} /></label>
<label className="field-label">Registration no.<input required value={authForm.registrationNumber} onChange={(e) => setAuthForm({ ...authForm, registrationNumber: e.target.value })} /></label>
</div>
</>}
<button className="button button-terra button-full" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : authMode === 'doctor' ? 'Create doctor profile' : 'Create patient account'} <span>→</span></button>
</form>
<div className="auth-switch">
{authMode === 'login' ? <>New to Schedula? <button onClick={() => setAuthMode('register')}>Create patient account</button> <button onClick={() => setAuthMode('doctor')}>Join as a doctor</button></> : <>Already have an account? <button onClick={() => setAuthMode('login')}>Sign in</button></>}
</div>
</section>
</div>}
</main>;
}
