'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money } from '../../lib/api';

type RazorpayCheckoutResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type PaymentOrder = { paymentId: string; orderId?: string; amount: number; currency: string; keyId?: string; status: string };
type Appointment = {
  id: string; bookingReference: string; status: string; feeAmountMinor: number; feeCurrency: string; visitKind: string;
  doctor: { profile?: { displayName: string } | null }; session: { sessionDate: string; startTime: string };
};
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void }; } }

export default function CheckoutPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    try { setAppointments(await api<Appointment[]>('/appointments/mine')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load appointments.'); }
  }
  useEffect(() => { void refresh(); }, []);

  async function pay(appointment: Appointment) {
    setBusy(appointment.id); setError(''); setNotice('');
    try {
      const order = await api<PaymentOrder>('/payments/orders', { method: 'POST', body: JSON.stringify({ appointmentId: appointment.id }) });
      if (order.status === 'CAPTURED') { setNotice('This appointment is already paid.'); setBusy(''); return; }
      if (order.status === 'REFUND_PENDING' || order.status === 'REFUNDED') { setNotice('This payment has a refund state (' + order.status + '). Check payment history.'); setBusy(''); return; }
      if (!order.orderId || !order.keyId) throw new Error('The provider order is incomplete. Check payment history before retrying.');
      if (!window.Razorpay) {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Unable to load Razorpay Checkout. Please retry.'));
          document.body.appendChild(script);
        });
      }
      if (!window.Razorpay) throw new Error('Razorpay Checkout did not initialize.');
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Schedula',
        description: 'Appointment ' + appointment.bookingReference,
        order_id: order.orderId,
        notes: { appointmentId: appointment.id },
        theme: { color: '#14362b' },
        handler: async (response: RazorpayCheckoutResponse) => {
          try {
            await api<{ status: string }>('/payments/verify', { method: 'POST', body: JSON.stringify(response) });
            setNotice('Payment verified by Schedula.');
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Server verification failed. Check payment history before retrying.');
          } finally { setBusy(''); }
        },
        modal: { ondismiss: () => setBusy('') },
      });
      checkout.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout.');
      setBusy('');
    }
  }

  const payable = appointments.filter((a) => a.status === 'BOOKED' && a.feeAmountMinor > 0);
  return <main className="app-shell subpage-shell">
    <nav className="nav-bar page-width"><Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link><div className="nav-links"><Link href="/appointments">My appointments</Link><Link href="/payments">Payment history</Link></div></nav>
    <section className="subpage-hero page-width"><span className="eyebrow">SECURE CHECKOUT</span><h1>Payment, <em>with clarity.</em></h1><p>Complete checkout through Razorpay. Schedula marks payment as captured only after server-side verification.</p></section>
    <section className="page-width page-content">
      {error && <div className="notice notice-error" role="alert"><span>!</span><p>{error}</p></div>}
      {notice && <div className="notice notice-success" role="status"><span>✓</span><p>{notice}</p></div>}
      {payable.length === 0
        ? <div className="empty-state"><h2>No payable appointments found</h2><p>Book a visit first, or check your appointment history.</p><Link className="button button-terra" href="/appointments">My appointments</Link></div>
        : <div className="appointment-list">{payable.map((a) => <article className="appointment-card" key={a.id}><div className="appointment-main"><span className="eyebrow">{a.visitKind.replaceAll('_', ' ')}</span><h3>{a.doctor.profile?.displayName ?? 'Your doctor'}</h3><p>{new Date(a.session.sessionDate).toLocaleDateString('en-IN')} · {a.bookingReference}</p><div className="appointment-meta"><strong>{money(a.feeAmountMinor, a.feeCurrency)}</strong><span>Pay online</span></div><button className="button button-terra" disabled={Boolean(busy)} onClick={() => void pay(a)}>{busy === a.id ? 'Opening secure checkout…' : 'Pay with Razorpay ↗'}</button></div></article>)}</div>}
      <p className="fine-print">A browser callback is not proof of payment. The server verifies the payment with Razorpay and processes signed webhooks.</p>
    </section>
    <footer className="footer page-width"><Link href="/" className="brand"><span className="brand-mark">S</span><span>Schedula<span className="brand-dot">.</span></span></Link><span>Care, coordinated with clarity.</span></footer>
  </main>;
}
