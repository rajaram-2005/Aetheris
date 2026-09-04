import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { store } from "@/lib/store";
import { renderMarkdown } from "@/components/markdown";
import type { SharedChat } from "@/app/api/share/route";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const s = await store.get<SharedChat>("shares", id);
  if (s) store.update<SharedChat>("shares", id, (c) => ({ ...(c ?? s), views: (c?.views ?? 0) + 1 })).catch(() => undefined);
  return s ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const s = await store.get<SharedChat>("shares", (await params).id);
  return { title: s ? `${s.title} · Aetheris` : "Aetheris", description: s?.messages[0]?.content.slice(0, 160) };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await load((await params).id);
  if (!s) notFound();
  return (
    <div className="share-wrap">
      <header className="share-head">
        <a href="/" className="brand" style={{ textDecoration: "none" }}><span className="hero-orb" style={{ width: 22, height: 22, margin: 0, borderRadius: 7, display: "inline-block", verticalAlign: "middle" }} /> <b>Aetheris</b></a>
        <h1>{s.title}</h1>
        <div className="hint" style={{ margin: 0 }}>Shared {new Date(s.createdAt).toLocaleDateString("en-IN")} · {s.messages.length} messages · read-only</div>
      </header>
      <main className="share-msgs">
        {s.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" && <div className="avatar" aria-hidden><span /></div>}
            <div className="msg-body">
              {m.role === "user" ? <div className="bubble">{m.content}</div> : <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
              {m.provider && <div className="meta">{m.provider}{m.model ? ` · ${m.model}` : ""}</div>}
            </div>
          </div>
        ))}
      </main>
      <footer className="share-foot"><a className="send" href={`/?continue=${s.id}`}>Continue this chat in Aetheris →</a> <span className="hint">Free for everyone. Open source.</span></footer>
    </div>
  );
}
