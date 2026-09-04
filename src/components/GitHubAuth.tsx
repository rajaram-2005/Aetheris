"use client";

import { useCallback, useEffect, useState } from "react";

export interface GhUser { login: string; avatar?: string; via: "oauth" | "pat" }

export function useGitHubAuth() {
  const [user, setUser] = useState<GhUser | null>(null);
  const [oauth, setOauth] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      const j = await r.json();
      setUser(j.user);
      setOauth(j.oauth);
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    const r = await fetch("/api/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Sign-in failed");
    setUser(j);
  }, []);

  return { user, oauth, loaded, refresh, logout, loginWithToken };
}

export default function GitHubAuth({ auth }: { auth: ReturnType<typeof useGitHubAuth> }) {
  const [showPat, setShowPat] = useState(false);
  const [pat, setPat] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!auth.loaded) return null;

  if (auth.user) {
    return (
      <div className="gh-user" title={`Signed in via ${auth.user.via}`}>
        {auth.user.avatar && <img src={auth.user.avatar} alt="" />}
        <span>{auth.user.login}</span>
        <button className="link" onClick={auth.logout}>sign out</button>
      </div>
    );
  }

  return (
    <div className="gh-auth">
      {auth.oauth && (
        <a className="gh-btn" href="/api/auth/github">Sign in with GitHub</a>
      )}
      <button className="link" onClick={() => setShowPat((s) => !s)}>
        {auth.oauth ? "or use a token" : "Connect GitHub with a token"}
      </button>
      {showPat && (
        <form
          className="pat-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            setBusy(true);
            try { await auth.loginWithToken(pat); setPat(""); setShowPat(false); }
            catch (ex) { setErr((ex as Error).message); }
            finally { setBusy(false); }
          }}
        >
          <input
            type="password"
            placeholder="ghp_… (scopes: repo, workflow)"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoComplete="off"
          />
          <button className="send" disabled={!pat.trim() || busy}>Connect</button>
          {err && <div className="err-text">{err}</div>}
        </form>
      )}
    </div>
  );
}
