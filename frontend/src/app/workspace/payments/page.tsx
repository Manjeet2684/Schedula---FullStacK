'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '../../../lib/api';

type Payment = {
  id: string; appointmentId: string; patientId: string; amountMinor: number; currency: string; status: string;
  providerOrderId: string; providerPaymentId: string | null; createdAt: string;
  appointment: { bookingReference: string }; patient: { patientCode: string; givenName: string; familyName: string | null };
};

export default function AdminPaymentsPage() {
  const [items, setItems] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  async function refresh() {
    const me = await api<{ roles: string[] }>('/auth/me');
    if (!me.roles.includes('ADMIN')) throw new Error('Administrator access is required.');
    setItems(await api<Payment[]>('/payments/admin'));
  }

  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Could not load payments.')); }, []);

  async function refund(payment: Payment) {
    const reason = window.prompt('Reason for refund of ' + payment.appointment.bookingReference + ':');
    if (!reason || reason.trim().length < 3) return;
    setBusy(payment.id); setError(''); setNotice('');
    try {
      const result = await api<{ status: string }>('/payments/' + payment.id + '/refund', {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      setNotice('Refund requested. Current state: ' + result.status + '. Provider webhook confirmation is still required.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund request failed. Check Razorpay before retrying.');
    } finally {
      setBusy('');
    }
  }

  return <main className="app-shell subpage-shell">
    <nav className="nav-bar page-width">
      <Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link>
      <div className="nav-links"><Link href="/workspace">Workspace</Link><Link href="/payments">Patient payment history</Link></div>
    </nav>
    <section className="subpage-hero page-width">
      <span className="eyebrow">ADMINISTRATOR</span>
      <h1>Payment <em>operations.</em></h1>
      <p>Review Razorpay payment states and request full refunds for captured payments. Refunds remain pending until the provider confirms the outcome.</p>
    </section>
    <section className="page-width page-content">
      {error && <div className="notice notice-error" role="alert"><span>!</span><p>{error}</p></div>}
      {notice && <div className="notice notice-success" role="status"><span>✓</span><p>{notice}</p></div>}
      {items.length === 0 && !error
        ? <div className="empty-state"><h2>No payment records</h2><p>New payment attempts will appear here.</p></div>
        : <div className="appointment-list">{items.map((p) => <article className="appointment-card" key={p.id}>
          <div className="appointment-main">
            <div className="appointment-heading">
              <div><span className="eyebrow">{p.appointment.bookingReference}</span><h3>{p.patient.givenName} {p.patient.familyName ?? ''} · {p.patient.patientCode}</h3></div>
              <span className={'status-pill status-' + p.status.toLowerCase()}>{p.status.replaceAll('_', ' ')}</span>
            </div>
            <div className="appointment-meta"><strong>{money(p.amountMinor, p.currency)}</strong><span>Created {new Date(p.createdAt).toLocaleString('en-IN')}</span></div>
            <div className="appointment-ref"><span>Provider order</span><code>{p.providerOrderId}</code></div>
            {p.status === 'CAPTURED' && <button className="button button-outline danger-text" disabled={Boolean(busy)} onClick={() => void refund(p)}>{busy === p.id ? 'Submitting…' : 'Request full refund'}</button>}
          </div>
        </article>)}</div>}
    </section>
    <footer className="footer page-width"><Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link><span>Care, coordinated with clarity.</span></footer>
  </main>;
}
