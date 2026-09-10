"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * App Router error boundary. Never dumps a stack, credentials, or filesystem path.
 * The operator sees phase / cause / impact / recovery / system state.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const raw = typeof error.message === "string" ? error.message.trim() : "";
  const cause =
    raw && raw.length < 280 && !/\/home\/|\/Users\/|node_modules|at\s+\S+\s+\(/.test(raw)
      ? raw
      : "An unexpected error interrupted this view.";

  return (
    <div className="notice-wrap fail-wrap">
      <div className="notice-card fail-card" role="alert">
        <p className="fail-kicker">PHASE FAILED</p>
        <h1>This view could not be rendered</h1>
        <dl className="fail-dl">
          <div>
            <dt>Phase</dt>
            <dd>Page render</dd>
          </div>
          <div>
            <dt>Cause</dt>
            <dd>{cause}</dd>
          </div>
          <div>
            <dt>Impact</dt>
            <dd>This page is blocked. Other Aetheris surfaces remain available.</dd>
          </div>
          <div>
            <dt>Recovery</dt>
            <dd>Retry this view, or return to the workspace.</dd>
          </div>
          <div>
            <dt>System state</dt>
            <dd>BLOCKED</dd>
          </div>
        </dl>
        {error.digest ? (
          <p className="hint">
            Digest <code>{error.digest}</code>
          </p>
        ) : null}
        <div className="fail-actions">
          <button className="send" type="button" onClick={() => reset()}>
            Retry
          </button>
          <Link className="ghost" href="/">
            Workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
