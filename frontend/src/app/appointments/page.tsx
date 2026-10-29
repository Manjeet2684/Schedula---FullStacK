'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, localDate, money } from '../../lib/api';

type User = { id: string; email: string | null; roles: string[]; patientId: string | null };
type Appointment = {
  id: string; bookingReference: string; status: string; tokenNumber: number | null; visitKind: string; feeAmountMinor: number; feeCurrency: string;
  reasonForVisit?: string | null; createdAt: string; doctor: { id: string; profile?: { displayName: string } | null }; session: { sessionDate: string; startTime: string; endTime: string; sessionMode: string }; timedSlot?: { slotStartTime: string; slotEndTime: string } | null;
};
type Session = { id: string; allocations: Array<{ id: string; poolType: string; bookable: boolean; timedSlotId: string | null; slotStartTime: string | null; slotEndTime: string | null }> };

export default function AppointmentsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rescheduleId, setRescheduleId] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState(localDate());
  const [choices, setChoices] = useState<Array<{ id: string; doctorName: string; start: string; mode: string }>>([]);
  const [working, setWorking] = useState(false);

  async function refresh() {
    setLoading(true); setError('');
    try {
      const me = await api<User>('/auth/me'); setUser(me);
      if (!me.roles.includes('PATIENT')) throw new Error('This page is for patient accounts.');
      setItems(await api<Appointment[]>('/appointments/mine'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load appointments.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function cancel(item: Appointment) {
    const reason = window.prompt(`Reason for cancelling ${item.bookingReference}:`, 'Change of plans');
    if (!reason?.trim()) return;
    setWorking(true); setError('');
    try { await api(`/appointments/${item.id}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) }); setNotice(`Appointment ${item.bookingReference} cancelled.`); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Cancellation failed.'); }
    finally { setWorking(false); }
  }

  async function loadReschedule(item: Appointment, date = rescheduleDate) {
    setRescheduleId(item.id); setRescheduleDate(date); setChoices([]); setError('');
    try {
      const sessions = await api<Session[]>(`/catalog/doctors/${item.doctor.id}/availability?date=${date}`);
      setChoices(sessions.flatMap((session) => session.allocations.filter((a) => a.bookable && a.poolType === 'ADVANCE_BOOKING').map((a) => ({ id: a.id, doctorName: item.doctor.profile?.displayName || 'Doctor', start: a.slotStartTime || (session as unknown as { startTime?: string }).startTime || 'Next token', mode: 'Advance booking' }))));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load new availability.'); }
  }

  async function confirmReschedule(allocationId: string, item: Appointment) {
    setWorking(true); setError('');
    try { await api(`/appointments/${item.id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ allocationId, reason: 'Patient changed appointment time' }) }); setNotice(`Appointment ${item.bookingReference} rescheduled. The original reference has been retained.`); setRescheduleId(''); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Rescheduling failed.'); }
    finally { setWorking(false); }
  }

  return <main className="app-shell subpage-shell">
<nav className="nav-bar page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<div className="nav-links">
<Link href="/#doctors">Find a doctor</Link>
<Link href="/workspace">Workspace</Link>
</div>
<span className="signed-in">{user?.email || 'Patient portal'}</span>
</nav>
<section className="subpage-hero page-width">
<span className="eyebrow">YOUR CARE, IN ONE PLACE</span>
<h1>My <em>appointments.</em></h1>
<p>Confirmation details, upcoming visits, and rescheduling—kept together.</p>
</section>
<div className="page-width page-content">
{notice && <div className="notice notice-success" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice('')}>×</button></div>}
{error && <div className="notice notice-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')}>×</button></div>}
{loading
  ? <div className="empty-state"><div className="loader"/><p>Loading your visits…</p></div>
  : !user
    ? <div className="empty-state"><h2>Sign in to see your appointments.</h2><p>Return to the home page and sign in with your patient account.</p><Link className="button button-terra" href="/">Go to Schedula</Link></div>
    : items.length === 0
      ? <div className="empty-state"><div className="empty-symbol">◷</div><h2>Your next visit starts here.</h2><p>You do not have any appointments yet.</p><Link className="button button-terra" href="/#doctors">Find a doctor ↗</Link></div>
      : <div className="appointment-list">{items.map((item) => {
          const day = new Date(item.session.sessionDate);
          const isUpcoming = item.status === 'BOOKED' || item.status === 'CHECKED_IN';
          return <article className="appointment-card" key={item.id}>
<div className="appointment-date">
<strong>{Number.isNaN(day.getTime()) ? '—' : day.toLocaleDateString('en-IN', { day: '2-digit' })}</strong>
<span>{Number.isNaN(day.getTime()) ? 'DATE' : day.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
</div>
<div className="appointment-main">
<div className="appointment-heading">
<div><span className="eyebrow">{item.visitKind === 'NEW_VISIT' ? 'NEW VISIT' : 'FOLLOW-UP'}</span><h3>{item.doctor.profile?.displayName || 'Your doctor'}</h3></div>
<span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span>
</div>
<div className="appointment-meta">
<span>◷ {item.timedSlot ? `${item.timedSlot.slotStartTime.slice(11, 16)}–${item.timedSlot.slotEndTime.slice(11, 16)}` : `${item.session.startTime.slice(11, 16)}–${item.session.endTime.slice(11, 16)}`}</span>
{item.tokenNumber !== null && <span>Token #{item.tokenNumber}</span>}
<span>{money(item.feeAmountMinor, item.feeCurrency)}</span>
</div>
<div className="appointment-ref">
<span>Confirmation reference</span><code>{item.bookingReference}</code>
</div>
{isUpcoming && <div className="appointment-actions">
<button className="button button-outline" disabled={working} onClick={() => void loadReschedule(item)}>Change time</button>
<button className="button button-quiet danger-text" disabled={working} onClick={() => void cancel(item)}>Cancel appointment</button>
</div>}
{rescheduleId === item.id && <div className="reschedule-panel">
<label className="field-label">Choose a new date
<input type="date" min={localDate()} value={rescheduleDate} onChange={(e) => void loadReschedule(item, e.target.value)} />
</label>
<div className="reschedule-choices">
{choices.length === 0
  ? <p className="muted">No available advance slots on this date. Try another date.</p>
  : choices.map((choice) => <button key={choice.id} disabled={working} className="allocation-button" onClick={() => void confirmReschedule(choice.id, item)}>
<span>{choice.start.slice(0, 5)}</span>
<small>{choice.mode}</small>
<b>{working ? '…' : 'Move here ↗'}</b>
</button>)}
</div>
<button className="button button-quiet" onClick={() => setRescheduleId('')}>Close rescheduling</button>
</div>}
</div>
</article>;
        })}</div>}
</div>
<footer className="footer page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<span>Care, coordinated with clarity.</span>
<Link href="/#doctors">Find another doctor ↗</Link>
<small>© {new Date().getFullYear()} Schedula</small>
</footer>
</main>;
}
