"use client";

import { useCallback, useEffect, useState } from "react";

export interface Account {
  plan: { id: string; name: string } | null;
  expiresAt: number | null;
  features: string[];
  chat: { used: number; limit: number | null };
  plans: { id: string; name: string; priceInr: number; days: number; blurb: string; features: string[] }[];
  payee: { phone: string; email: string };
}

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/billing/plans", { cache: "no-store" });
      if (r.ok) setAccount(await r.json());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { account, refresh };
}

interface Checkout { id: string; amountInr: number; link: string; qr: string; status: string }

export default function Upgrade({ account, onClose, onChanged, reason }: {
  account: Account; onClose: () => void; onChanged: () => void; reason?: string;
}) {
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [utr, setUtr] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (planId: string) => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    setCheckout(j);
    setStatus("pending");
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkout) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/billing/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: checkout.id, utr }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    setStatus(j.status);
  };

  // Poll for approval once submitted.
  useEffect(() => {
    if (!checkout || status !== "submitted") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/billing/status?id=${checkout.id}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j.payment.status !== "submitted") { setStatus(j.payment.status); onChanged(); }
    }, 5000);
    return () => clearInterval(t);
  }, [checkout, status, onChanged]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        {!checkout ? (
          <>
            <h2>Upgrade Aetheris</h2>
            <p>{reason ?? "Unlock Pro Video Generation, unlimited chat and premium connectors."} Pay via UPI — GPay, PhonePe, Paytm or any UPI app.</p>
            <div className="plans">
              {account.plans.map((p) => (
                <button key={p.id} className="plan" onClick={() => start(p.id)} disabled={busy}>
                  <div className="name">{p.name}</div>
                  <div className="price">₹{p.priceInr}<small> / {p.days} days</small></div>
                  <div className="blurb">{p.blurb}</div>
                </button>
              ))}
            </div>
            {err && <div className="err-text">{err}</div>}
            <p>Questions? WhatsApp {account.payee.phone} · {account.payee.email}</p>
          </>
        ) : status === "approved" ? (
          <div className="qr">
            <h2>✓ Unlocked</h2>
            <p>Your plan is active. Enjoy Aetheris Pro.</p>
            <button className="send" onClick={onClose}>Done</button>
          </div>
        ) : status === "rejected" ? (
          <div className="qr">
            <h2>Payment not verified</h2>
            <p>We couldn&apos;t match that UTR. Contact {account.payee.phone} on WhatsApp with your payment screenshot.</p>
            <button className="ghost" onClick={() => { setCheckout(null); setStatus(null); }}>Try again</button>
          </div>
        ) : status === "submitted" ? (
          <div className="qr">
            <h2>Verifying…</h2>
            <p>UTR received for <span className="ref">{checkout.id}</span>. Your plan unlocks automatically once the payment is confirmed. You can close this window.</p>
            <span className="typing"><i /><i /><i /></span>
          </div>
        ) : (
          <div className="qr">
            <h2>Scan &amp; pay</h2>
            <img src={checkout.qr} alt="UPI QR code" width={220} height={220} />
            <div className="amt">₹{checkout.amountInr}</div>
            <div className="ref">Ref {checkout.id} · to {account.payee.phone}</div>
            <div className="qr-actions">
              <a className="gh-btn" href={checkout.link}>Open UPI app</a>
            </div>
            <p>After paying, enter the 12-digit UPI reference (UTR) from your app:</p>
            <form className="utr-form" onSubmit={confirm}>
              <input placeholder="UTR / UPI Ref No." value={utr} onChange={(e) => setUtr(e.target.value)} inputMode="numeric" />
              <button className="send" disabled={busy || utr.replace(/\D/g, "").length !== 12}>Submit</button>
            </form>
            {err && <div className="err-text">{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
