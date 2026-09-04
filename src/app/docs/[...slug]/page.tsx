import { notFound } from "next/navigation";
import { renderMarkdown } from "@/components/markdown";
import { GUIDES } from "@/lib/docs/guides";
import { referencePages } from "@/lib/docs/reference";

export const dynamic = "force-static";

function allPages() { return [...GUIDES, ...referencePages()]; }
export function generateStaticParams() { return allPages().map((p) => ({ slug: [p.slug] })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const p = allPages().find((x) => x.slug === slug[0]);
  return { title: p ? `${p.title} · Aetheris Docs` : "Aetheris Docs" };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const pages = allPages();
  const slug = (await params).slug[0];
  const page = pages.find((p) => p.slug === slug);
  if (!page) notFound();
  const sections = Array.from(new Set(pages.map((p) => p.section)));
  const idx = pages.indexOf(page); const prev = pages[idx - 1]; const next = pages[idx + 1];
  return (
    <div className="docs">
      <aside className="docs-nav">
        <a href="/" className="brand" style={{ textDecoration: "none", marginBottom: 10, display: "block" }}><b>✦ Aetheris</b> <span className="hint" style={{ margin: 0 }}>docs</span></a>
        {sections.map((s) => (
          <div key={s} className="docs-sec">
            <div className="docs-sec-title">{s}</div>
            {pages.filter((p) => p.section === s && !p.slug.startsWith("concept-")).map((p) => <a key={p.slug} href={`/docs/${p.slug}`} className={p.slug === slug ? "on" : ""}>{p.title}</a>)}
            {s === "Explained AI" && slug.startsWith("concept-") && <a href={`/docs/${slug}`} className="on" style={{ paddingLeft: 18 }}>↳ {page.title}</a>}
          </div>
        ))}
      </aside>
      <main className="docs-main">
        <div className="hint" style={{ textAlign: "left", margin: 0 }}>{page.section}</div>
        <h1>{page.title}</h1>
        <article className="bubble docs-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body.trim()) }} />
        <nav className="docs-pager">
          {prev ? <a href={`/docs/${prev.slug}`}>← {prev.title}</a> : <span />}
          {next ? <a href={`/docs/${next.slug}`}>{next.title} →</a> : <span />}
        </nav>
        <p className="hint">Edit this page: <code>src/lib/docs/{page.slug.startsWith("ref-") ? "reference.ts (generated from catalogs)" : "guides.ts"}</code></p>
      </main>
    </div>
  );
}
