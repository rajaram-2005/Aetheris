"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { safeReturnTo } from "@/lib/auth/return-to";

type Methods = { guest: boolean };

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeReturnTo(sp.get("next"));
  const { t } = useLang();
  const [methods, setMethods] = useState<Methods | null>(null);
  // Keep the guest path one click away. The name is still editable, but a visitor who simply
  // clicks the button gets a valid display name instead of a silently disabled form.
  const [name, setName] = useState("Guest");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(sp.get("error"));

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setMethods({ guest: j.methods?.guest === true });
        if (j.account) router.replace(next);
      })
      .catch(() => setErr("Could not check sign-in availability. Please refresh."));
  }, [router, next]);

  const continueAsGuest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (methods && !methods.guest) { setErr("Guest access is disabled on this deployment."); return; }
    setBusy(true); setErr(null);
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Guest" }),
      });
      const value = await response.json();
      if (!response.ok) { setErr(value.error ?? "Could not start a guest session."); return; }
      // The session is set by the response above. Use a real browser navigation rather than an
      // in-app RSC transition so the new HTTP-only cookie is sent on the very first app request
      // (and middleware gets a chance to re-check it). This also avoids leaving the user on a
      // cached login route after a successful guest sign-in.
      const destination = new URL(next, window.location.origin);
      window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`);
    } catch {
      setErr("Could not start a guest session. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="hero-orb" style={{ width: 56, height: 56, margin: "0 auto 10px" }} />
        <h1>{t("login.title")}</h1>
        <p className="hint" style={{ margin: "0 0 18px" }}>{t("login.sub")}</p>

        <form className="login-form" onSubmit={continueAsGuest}>
          <label className="login-guest-label" htmlFor="guest-name">{t("login.guestPrompt")}</label>
          <input id="guest-name" autoComplete="name" maxLength={50} placeholder={t("login.guestPlaceholder")} value={name} onChange={(event) => setName(event.target.value)} />
          <button className="send" disabled={busy || !!(methods && !methods.guest)}>{busy ? t("login.starting") : t("login.continueGuest")}</button>
        </form>

        {err && <div className="err-text" role="alert" style={{ marginTop: 10 }}>{err}</div>}
        <p className="hint login-required" style={{ marginTop: 18 }}>{t("login.guestNote")}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
