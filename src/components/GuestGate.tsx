"use client";

import { useEffect, useState, type ReactNode } from "react";
import { safeReturnTo } from "@/lib/auth/return-to";
import { useLang } from "@/lib/i18n";

interface GuestGateProps { children: ReactNode }

type GateState = "checking" | "guest" | "ready";

/**
 * Hosted entry point. Authentication is collected in the app shell rather than a separate login
 * route, so a visitor only sees the one thing needed to start: their display name.
 */
export default function GuestGate({ children }: GuestGateProps) {
  const { t } = useLang();
  const [state, setState] = useState<GateState>("checking");
  const [guestEnabled, setGuestEnabled] = useState<boolean | null>(null);
  const [name, setName] = useState("Guest");
  const [next, setNext] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const destination = safeReturnTo(params.get("next"));
    setNext(destination);
    setError(params.get("error"));

    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session) => {
        const required = session.authRequired === true;
        const enabled = session.methods?.guest === true;
        setGuestEnabled(enabled);
        if (!required || session.account) {
          if (session.account && destination !== "/") {
            window.location.replace(destination);
            return;
          }
          setState("ready");
          return;
        }
        setState("guest");
      })
      .catch(() => {
        setGuestEnabled(null);
        setError("Could not check sign-in availability. Please refresh.");
        setState("guest");
      });
  }, []);

  const continueAsGuest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (guestEnabled === false) {
      setError("Guest access is disabled on this deployment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Guest", next }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(value.error ?? "Could not start a guest session.");
        return;
      }
      const destination = new URL(next, window.location.origin);
      window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`);
    } catch {
      setError("Could not start a guest session. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "ready") return <>{children}</>;
  if (state === "checking") {
    return <div className="guest-wrap"><div className="guest-card"><div className="hero-orb" style={{ width: 56, height: 56, margin: "0 auto 10px" }} /><p className="hint">Starting Aetheris…</p></div></div>;
  }

  return (
    <div className="guest-wrap">
      <div className="guest-card">
        <div className="hero-orb" style={{ width: 56, height: 56, margin: "0 auto 10px" }} />
        <h1>{t("login.title")}</h1>
        <p className="hint" style={{ margin: "0 0 18px" }}>{t("login.sub")}</p>

        <form className="guest-form" method="post" action="/api/auth/guest" onSubmit={continueAsGuest}>
          <input type="hidden" name="next" value={next} />
          <label className="guest-label" htmlFor="guest-name">{t("login.guestPrompt")}</label>
          <input id="guest-name" name="name" autoComplete="name" maxLength={50} placeholder={t("login.guestPlaceholder")} value={name} onChange={(event) => setName(event.target.value)} />
          <button className="send" disabled={busy || guestEnabled === false}>{busy ? t("login.starting") : t("login.continueGuest")}</button>
        </form>

        {error && <div className="err-text" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        <p className="hint" style={{ marginTop: 18 }}>{t("login.guestNote")}</p>
      </div>
    </div>
  );
}
