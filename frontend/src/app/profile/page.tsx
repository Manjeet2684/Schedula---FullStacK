'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, localDate } from '../../lib/api';

type Profile = { id: string; patientCode: string; givenName: string; familyName: string | null; sex: string; dateOfBirth: string | null; ageEstimatedYears: number | null; contactPhone: string; alternatePhone: string | null; email: string | null; guardianName: string | null; whatsappOptIn: boolean };
type Dependent = { id: string; patientCode: string; givenName: string; familyName: string | null; sex: string; dateOfBirth: string | null; ageEstimatedYears: number | null; contactPhone: string; guardianName: string | null; whatsappOptIn: boolean };
type FormState = { givenName: string; familyName: string; sex: string; dateOfBirth: string; ageEstimatedYears: string; contactPhone: string; alternatePhone: string; email: string; guardianName: string; whatsappOptIn: boolean };
const emptyForm: FormState = { givenName: '', familyName: '', sex: 'UNKNOWN', dateOfBirth: '', ageEstimatedYears: '', contactPhone: '', alternatePhone: '', email: '', guardianName: '', whatsappOptIn: false };

export default function ProfilePage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [dependent, setDependent] = useState({ givenName: '', familyName: '', sex: 'UNKNOWN', dateOfBirth: '', ageEstimatedYears: '10', contactPhone: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const result = await api<Profile>('/patients/me');
      setProfile(result);
      setForm({ givenName: result.givenName, familyName: result.familyName ?? '', sex: result.sex, dateOfBirth: result.dateOfBirth?.slice(0, 10) ?? '', ageEstimatedYears: result.ageEstimatedYears?.toString() ?? '', contactPhone: result.contactPhone, alternatePhone: result.alternatePhone ?? '', email: result.email ?? '', guardianName: result.guardianName ?? '', whatsappOptIn: result.whatsappOptIn });
      setDependents(await api<Dependent[]>('/patients/me/dependents'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign in with a patient account to manage profiles.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const body: Record<string, unknown> = { ...form };
      if (form.dateOfBirth) delete body['ageEstimatedYears'];
      else { body['dateOfBirth'] = null; body['ageEstimatedYears'] = Number(form.ageEstimatedYears); }
      const result = await api<Profile>('/patients/me', { method: 'PATCH', body: JSON.stringify(body) });
      setProfile(result); setNotice('Patient profile saved.'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your profile.'); }
    finally { setSaving(false); }
  }

  async function createDependent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    const body: Record<string, unknown> = { ...dependent };
    if (dependent.dateOfBirth) delete body['ageEstimatedYears'];
    else { body['dateOfBirth'] = null; body['ageEstimatedYears'] = Number(dependent.ageEstimatedYears); }
    try {
      await api('/patients/me/dependents', { method: 'POST', body: JSON.stringify(body) });
      setDependent({ givenName: '', familyName: '', sex: 'UNKNOWN', dateOfBirth: '', ageEstimatedYears: '10', contactPhone: '' });
      setNotice('Dependent profile added. You can select them when booking a visit.');
      setDependents(await api<Dependent[]>('/patients/me/dependents'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add dependent.'); }
    finally { setSaving(false); }
  }

  return <main className="app-shell subpage-shell">
<nav className="nav-bar page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<div className="nav-links">
<Link href="/#doctors">Find a doctor</Link>
<Link href="/appointments">My appointments</Link>
</div>
<span className="signed-in">Patient profile</span>
</nav>
<section className="subpage-hero page-width">
<span className="eyebrow">YOUR DETAILS, YOUR CONTROL</span>
<h1>Patient <em>profiles.</em></h1>
<p>Keep your details current and add dependents you book appointments for.</p>
{profile && <div className="role-pills"><span className="role-pill">{profile.patientCode}</span><span className="role-pill">Privacy settings</span></div>}
</section>
<div className="page-width page-content">
{notice && <div className="notice notice-success" role="status"><span>✓</span><p>{notice}</p><button onClick={() => setNotice('')}>×</button></div>}
{error && <div className="notice notice-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError('')}>×</button></div>}
{loading
  ? <div className="empty-state"><div className="loader"/><p>Loading profile…</p></div>
  : !profile
    ? <div className="empty-state"><h2>Sign in with a patient account.</h2><p>Your personal details are protected and only available to your account.</p><Link href="/" className="button button-terra">Return to Schedula ↗</Link></div>
    : <div className="profile-layout">
<section className="panel-card">
<div className="profile-title-row">
<div>
<span className="eyebrow">PRIMARY PATIENT</span>
<h2>Personal information</h2>
<p>Use either a date of birth or estimated age.</p>
</div>
<span className="profile-code">{profile.patientCode}</span>
</div>
<form className="form-grid profile-form" onSubmit={saveProfile}>
<label className="field-label">First name<input required value={form.givenName} onChange={(e) => setForm({ ...form, givenName: e.target.value })} /></label>
<label className="field-label">Last name<input value={form.familyName} onChange={(e) => setForm({ ...form, familyName: e.target.value })} /></label>
<label className="field-label">Sex<select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
<option value="UNKNOWN">Prefer not to say</option>
<option value="FEMALE">Female</option>
<option value="MALE">Male</option>
<option value="OTHER">Other</option>
</select></label>
<label className="field-label">Phone<input required value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></label>
<label className="field-label">Alternate phone<input value={form.alternatePhone} onChange={(e) => setForm({ ...form, alternatePhone: e.target.value })} /></label>
<label className="field-label">Contact email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
<label className="field-label">Date of birth<input type="date" max={localDate()} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
{!form.dateOfBirth && <label className="field-label">Estimated age<input type="number" min="0" max="130" required value={form.ageEstimatedYears} onChange={(e) => setForm({ ...form, ageEstimatedYears: e.target.value })} /></label>}
<label className="field-label">Guardian / contact name<input value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></label>
<label className="consent-check">
<input type="checkbox" checked={form.whatsappOptIn} onChange={(e) => setForm({ ...form, whatsappOptIn: e.target.checked })} />
<span><b>WhatsApp contact preference</b><small>Allow the clinic to use WhatsApp for appointment updates. This does not activate messaging by itself.</small></span>
</label>
<div className="form-submit"><button className="button button-terra" disabled={saving}>{saving ? 'Saving…' : 'Save profile ↗'}</button></div>
</form>
</section>
<section className="panel-card dependents-panel">
<span className="eyebrow">FAMILY PROFILES</span>
<h2>Dependents</h2>
<p>Each dependent receives a separate patient record. Appointment booking will let you choose who the visit is for.</p>
{dependents.length === 0
  ? <div className="empty-inline"><span>＋</span><p>No dependents have been added yet.</p></div>
  : <div className="dependent-list">{dependents.map((item) =>
<article className="dependent-row" key={item.id}>
<div className="dependent-initials">{item.givenName.charAt(0).toUpperCase()}</div>
<div>
<b>{item.givenName} {item.familyName}</b>
<span>{item.patientCode} · {item.sex}</span>
<small>{item.dateOfBirth ? `DOB ${item.dateOfBirth.slice(0, 10)}` : `Estimated age ${item.ageEstimatedYears}`}</small>
</div>
</article>)}</div>}
<details className="create-patient-details" open={dependents.length === 0}>
<summary>Add a dependent</summary>
<form className="stack-form" onSubmit={createDependent}>
<label className="field-label">First name<input required value={dependent.givenName} onChange={(e) => setDependent({ ...dependent, givenName: e.target.value })} /></label>
<label className="field-label">Last name<input value={dependent.familyName} onChange={(e) => setDependent({ ...dependent, familyName: e.target.value })} /></label>
<label className="field-label">Sex<select value={dependent.sex} onChange={(e) => setDependent({ ...dependent, sex: e.target.value })}>
<option value="UNKNOWN">Prefer not to say</option>
<option value="FEMALE">Female</option>
<option value="MALE">Male</option>
<option value="OTHER">Other</option>
</select></label>
<label className="field-label">Date of birth<input type="date" max={localDate()} value={dependent.dateOfBirth} onChange={(e) => setDependent({ ...dependent, dateOfBirth: e.target.value })} /></label>
{!dependent.dateOfBirth && <label className="field-label">Estimated age<input type="number" min="0" max="130" required value={dependent.ageEstimatedYears} onChange={(e) => setDependent({ ...dependent, ageEstimatedYears: e.target.value })} /></label>}
<label className="field-label">Contact phone (defaults to yours)<input value={dependent.contactPhone} onChange={(e) => setDependent({ ...dependent, contactPhone: e.target.value })} /></label>
<button className="button button-outline" disabled={saving}>Add dependent ↗</button>
</form>
</details>
</section>
</div>}
</div>
<footer className="footer page-width">
<Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
<span>Care, coordinated with clarity.</span>
<Link href="/appointments">My appointments ↗</Link>
<small>© {new Date().getFullYear()} Schedula</small>
</footer>
</main>;
}
