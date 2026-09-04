"use client";

import { useCallback, useEffect, useState } from "react";

interface Payment {
  id: string; uid: string; planId: string; amountInr: number; status: string;
  createdAt: number; utr?: string; submittedAt?: number; decidedAt?: number; note?: string;
}

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [filter, setFilter] = useState("submitted");
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<{ users: { uid: string; planId: string; expiresAt: number; active: boolean; usedToday: number; apiKeys: number; grantedBy: string }[]; totals: { users: number; mrrInr: number; activeToday: number } } | null>(null);
  const loadUsers = useCallback(async (k = key) => {
    if (!k) return;
    const r = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${k}` }, cache: "no-store" });
    if (r.ok) setUsers(await r.json());
  }, [key]);
  const setPlan = async (uid: string, planId: string) => {
    await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ uid, planId }) });
    loadUsers();
  };

  useEffect(() => { setKey(localStorage.getItem("aetheris.admin") ?? ""); }, []);

  const load = useCallback(async (k = key, f = filter) => {
    if (!k) return;
    setErr(null);
    const r = await fetch(`/api/admin/payments${f ? `?status=${f}` : ""}`, { headers: { Authorization: `Bearer ${k}` }, cache: "no-store" });
    if (!r.ok) { setErr(r.status === 401 ? "Invalid admin key" : "Failed to load"); setPayments(null); return; }
    localStorage.setItem("aetheris.admin", k);
    setPayments((await r.json()).payments);
    loadUsers(k);
  }, [key, filter]);

  useEffect(() => { if (key) load(key, filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, approve: boolean) => {
    const note = approve ? undefined : prompt("Reason for rejection (optional)") ?? undefined;
    await fetch("/api/admin/payments", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ id, approve, note }),
    });
    load();
  };

  return (
    <div className="admin">
      <h1>Aetheris · Admin</h1>
      {users && (
        <div className="admin-stats">
          <div><b>{users.totals.users}</b><span>active subscribers</span></div>
          <div><b>₹{users.totals.mrrInr.toLocaleString("en-IN")}</b><span>MRR</span></div>
          <div><b>{users.totals.activeToday}</b><span>users active today</span></div>
        </div>
      )}
      <form className="admin-key" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input type="password" placeholder="AETHERIS_ADMIN_KEY" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="send">Load</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="submitted">Awaiting approval</option>
          <option value="pending">Pending (not paid)</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </form>
      {err && <p className="err-text">{err}</p>}
      {payments && (
        <table>
          <thead><tr><th>Ref</th><th>Plan</th><th>₹</th><th>UTR</th><th>Status</th><th>When</th><th /></tr></thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>Nothing here.</td></tr>}
            {payments.map((p) => (
              <tr key={p.id}>
                <td><code>{p.id}</code></td>
                <td>{p.planId}</td>
                <td>{p.amountInr}</td>
                <td><code>{p.utr ?? "—"}</code></td>
                <td className={`st-${p.status}`}>{p.status}{p.note ? ` · ${p.note}` : ""}</td>
                <td>{new Date(p.submittedAt ?? p.createdAt).toLocaleString("en-IN")}</td>
                <td>
                  {p.status !== "approved" && <button className="send" onClick={() => act(p.id, true)}>Approve</button>}{" "}
                  {p.status === "submitted" && <button className="ghost" onClick={() => act(p.id, false)}>Reject</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {users && (
        <>
          <h2 style={{ fontSize: 15, marginTop: 24 }}>Subscribers</h2>
          <table>
            <thead><tr><th>User</th><th>Plan</th><th>Expires</th><th>Used today</th><th>API keys</th><th>Change plan</th></tr></thead>
            <tbody>
              {users.users.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No subscribers yet.</td></tr>}
              {users.users.map((u) => (
                <tr key={u.uid} style={{ opacity: u.active ? 1 : 0.5 }}>
                  <td><code>{u.uid.slice(0, 10)}…</code></td>
                  <td>{u.planId}{u.grantedBy === "admin" ? " (manual)" : ""}</td>
                  <td>{new Date(u.expiresAt).toLocaleDateString("en-IN")}</td>
                  <td>{u.usedToday}</td>
                  <td>{u.apiKeys}</td>
                  <td>
                    <select defaultValue={u.planId} onChange={(e) => setPlan(u.uid, e.target.value)}>
                      {["free", "lite", "pro", "pro-max", "god-mode"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="hint">Verify the UTR against your GPay/PhonePe history for +91 94884 07998 before approving. Approval grants the plan instantly.</p>
    </div>
  );
}
