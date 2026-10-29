'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '../../lib/api';

type Payment = {
  id: string; appointmentId: string; amountMinor: number; currency: string; status: string;
  providerOrderId: string; providerPaymentId: string | null; createdAt: string; capturedAt: string | null; refundedAt: string | null;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Payment[]>('/payments/mine').then(setPayments).catch((e) => setError(e instanceof Error ? e.message : 'Could not load payment history.'));
  }, []);
  return <main className="app-shell subpage-shell">
    <nav className="nav-bar page-width"><Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link><div className="nav-links"><Link href="/appointments">My appointments</Link><Link href="/checkout">Checkout</Link></div></nav>
    <section className="subpage-hero page-width"><span className="eyebrow">PAYMENTS</span><h1>Your payment <em>history.</em></h1><p>Provider order references, amount, and the latest server-confirmed state.</p><div className="hero-actions"><Link className="button button-terra" href="/checkout">Pay for an appointment ↗</Link></div></section>
    <section className="page-width page-content">
      {error && <div className="notice notice-error" role="alert"><span>!</span><p>{error}</p></div>}
      {payments.length === 0 && !error
        ? <div className="empty-state"><h2>No payment records yet</h2><p>Payment records will appear after you start checkout for a booked appointment.</p><Link className="button button-terra" href="/checkout">Go to checkout</Link></div>
        : <div className="appointment-list">{payments.map((p) => <article className="appointment-card" key={p.id}><div className="appointment-main"><div className="appointment-heading"><div><span className="eyebrow">PAYMENT RECORD</span><h3>{money(p.amountMinor, p.currency)}</h3></div><span className={'status-pill status-' + p.status.toLowerCase()}>{p.status.replaceAll('_', ' ')}</span></div><div className="appointment-ref"><span>Appointment ID</span><code>{p.appointmentId}</code></div><div className="appointment-ref"><span>Provider order</span><code>{p.providerOrderId}</code></div><div className="appointment-meta"><span>Created {new Date(p.createdAt).toLocaleString('en-IN')}</span>{p.capturedAt && <span>Captured {new Date(p.capturedAt).toLocaleString('en-IN')}</span>}{p.refundedAt && <span>Refunded {new Date(p.refundedAt).toLocaleString('en-IN')}</span>}</div></div></article>)}</div>}
    </section>
  </main>;
}
