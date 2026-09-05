"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { safeReturnTo } from "@/lib/auth/return-to";

type Methods = { google: boolean; github: boolean; guest: boolean };

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeReturnTo(sp.get("next"));
  const { t } = useLang();
  const [methods, setMethods] = useState<Methods | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(sp.get("error"));

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { setMethods(j.methods); if (j.account) router.replace(next); })
      .catch(() => setErr("Could not check sign-in availability. Please refresh."));
  }, [router, next]);

  const continueAsGuest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (methods && !methods.guest) { setErr("Guest access is disabled on this deployment."); return; }
    setBusy(true); setErr(null);
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const value = await response.json();
      if (!response.ok) { setErr(value.error ?? "Could not start a guest session."); return; }
      const destination = new URL(next, window.location.origin);
      destination.searchParams.set("auth", "guest");
      router.replace(`${destination.pathname}${destination.search}${destination.hash}`);
    } catch {
      setErr("Could not start a guest session. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const oauthHref = (provider: "google" | "github") => `/api/auth/${provider}?next=${encodeURIComponent(next)}`;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="hero-orb" style={{ width: 56, height: 56, margin: "0 auto 10px" }} />
        <h1>{t("login.title")}</h1>
        <p className="hint" style={{ margin: "0 0 18px" }}>{t("login.sub")}</p>

        <div className="login-social">
          <a className={`login-btn ${methods && !methods.google ? "off" : ""}`} aria-disabled={methods ? !methods.google : undefined} href={oauthHref("google")} onClick={(event) => { if (methods && !methods.google) { event.preventDefault(); setErr("Google sign-in isn't configured on this deployment yet."); } }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-3.9-13.6-9.4l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            {t("login.google")}
          </a>
          <a className={`login-btn ${methods && !methods.github ? "off" : ""}`} aria-disabled={methods ? !methods.github : undefined} href={oauthHref("github")} onClick={(event) => { if (methods && !methods.github) { event.preventDefault(); setErr("GitHub sign-in isn't configured on this deployment yet."); } }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
            {t("login.github")}
          </a>
        </div>

        <div className="login-or"><span>{t("login.orGuest")}</span></div>

        <form className="login-form" onSubmit={continueAsGuest}>
          <label className="login-guest-label" htmlFor="guest-name">{t("login.guestPrompt")}</label>
          <input id="guest-name" autoComplete="name" minLength={2} maxLength={50} placeholder={t("login.guestPlaceholder")} value={name} onChange={(event) => setName(event.target.value)} required />
          <button className="send" disabled={busy || name.trim().length < 2 || !!(methods && !methods.guest)}>{busy ? t("login.starting") : t("login.continueGuest")}</button>
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
