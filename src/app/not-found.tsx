/**
 * App Router 404. Honest: the path is unknown. Nothing is invented to fill it.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="notice-wrap">
      <div className="notice-card" role="status">
        <p className="fail-kicker">NOT FOUND</p>
        <h1>This route does not exist</h1>
        <p className="hint">
          The path is not a known Aetheris surface. Use the workspace, docs, or the command palette
          (Ctrl/Cmd+K) to reach an implemented view.
        </p>
        <div className="fail-actions">
          <Link className="send" href="/">
            Workspace
          </Link>
          <Link className="ghost" href="/docs">
            Docs
          </Link>
        </div>
      </div>
    </div>
  );
}
