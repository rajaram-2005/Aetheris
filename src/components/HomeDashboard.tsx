"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import type { Conversation, Project } from "./store";
import type { Mode } from "./Sidebar";
import BrandTile from "./Brand";

interface ModelSummary {
  id: string;
  name: string;
  available: boolean;
  description: string;
}

interface MeshSummary {
  total: number;
  configured: number;
  ready: number;
  providers: { id: string; name: string; status?: string }[];
}

interface HomeDashboardProps {
  models: ModelSummary[];
  mesh: MeshSummary | null;
  convos: Conversation[];
  projects: Project[];
  servers: unknown[];
  onMode: (mode: Mode) => void;
  onAsk: (prompt: string) => void;
  onNewChat: () => void;
  onSettings: () => void;
}

const NAV_ITEMS: { label: string; icon: string; mode?: Mode; action?: "settings" | "projects" }[] = [
  { label: "Home", icon: "⌂", mode: "home" },
  { label: "Chat", icon: "▣", mode: "chat" },
  { label: "Agents", icon: "♙", mode: "agents" },
  { label: "Studio", icon: "✦", mode: "studio" },
  { label: "Tools", icon: "⌘", mode: "apps" },
  { label: "MCP Hub", icon: "♧", mode: "control" },
  { label: "Knowledge", icon: "▤", mode: "docs" },
  { label: "Automation", icon: "◌", mode: "workflows" },
  { label: "Projects", icon: "▱", action: "projects" },
  { label: "Hardware (IoT)", icon: "⌬", mode: "control" },
  { label: "Training", icon: "◎", mode: "learn" },
  { label: "Marketplace", icon: "▣", mode: "gallery" },
  { label: "Settings", icon: "⚙", action: "settings" },
];

const MODEL_CARDS = [
  { key: "gpt", name: "GPT-5", provider: "OpenAI", icon: "◎", tone: "cyan" },
  { key: "claude", name: "Claude 4", provider: "Anthropic", icon: "✣", tone: "orange" },
  { key: "gemini", name: "Gemini 2.5", provider: "Google", icon: "✦", tone: "blue" },
  { key: "grok", name: "Grok 4", provider: "xAI", icon: "◒", tone: "violet" },
  { key: "llama", name: "Llama 3.1", provider: "Meta", icon: "∞", tone: "indigo" },
  { key: "deepseek", name: "DeepSeek", provider: "DeepSeek", icon: "◈", tone: "sky" },
  { key: "qwen", name: "Qwen", provider: "Alibaba", icon: "✧", tone: "purple" },
];
const MODEL_LOGO_ID: Record<string, string> = { gpt: "openai", claude: "anthropic", gemini: "gemini", grok: "xai", llama: "meta", deepseek: "deepseek", qwen: "qwen" };

const QUICK_ACTIONS: { label: string; sub: string; icon: string; tone: string; prompt?: string; mode?: Mode }[] = [
  { label: "New Chat", sub: "Start a conversation", icon: "◌", tone: "cyan" },
  { label: "Create Agent", sub: "Build your AI agent", icon: "♙", tone: "violet", mode: "agents" },
  { label: "Analyse File", sub: "Upload & analyse", icon: "▤", tone: "purple", mode: "docs" },
  { label: "Generate Image", sub: "Turn ideas to visual", icon: "✦", tone: "teal", mode: "studio" },
  { label: "Write Code", sub: "Build something", icon: "⌘", tone: "blue", prompt: "Help me build something in code" },
  { label: "Control Hardware", sub: "IoT / ESP32 / PLC", icon: "⌬", tone: "green", mode: "control" },
  { label: "More Tools", sub: "100+ connectors", icon: "•••", tone: "indigo", mode: "apps" },
];

function Icon({ children, tone = "blue" }: { children: string; tone?: string }) {
  return <span className={`dash-icon dash-icon-${tone}`}>{children}</span>;
}

export default function HomeDashboard({ models, mesh, convos, projects, servers, onMode, onAsk, onNewChat, onSettings }: HomeDashboardProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const configuredModels = useMemo(() => models.filter((model) => model.available), [models]);
  const modelCount = mesh?.ready ?? configuredModels.length;
  const projectCards = projects.slice(0, 5);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (value) onAsk(value);
  };

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <Image src="/icon.svg" alt="" width={42} height={42} />
          <div><strong>AETHERIS</strong><span>INTELLIGENCE WITHOUT LIMITS</span></div>
        </div>

        <nav className="dashboard-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const active = item.mode === "home";
            return (
              <button key={item.label} className={`dashboard-nav-item ${active ? "active" : ""}`} onClick={() => {
                if (item.action === "settings") onSettings();
                else if (item.action === "projects") onMode("chat");
                else if (item.mode) onMode(item.mode);
              }}>
                <span className="dashboard-nav-icon">{item.icon}</span><span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="core-status">
          <div className="core-status-head"><span>Aetheris Core</span><span className="online-dot">● Online</span></div>
          <div className="core-visual"><div className="core-cube"><i /><i /><i /></div></div>
          <div className="core-metrics">
            <span>CPU <b>12%</b><i><em style={{ width: "28%" }} /></i></span>
            <span>GPU <b>28%</b><i><em style={{ width: "42%" }} /></i></span>
            <span>RAM <b>46%</b><i><em style={{ width: "58%" }} /></i></span>
            <span>Storage <b>32%</b><i><em style={{ width: "40%" }} /></i></span>
            <span>Network <b>12 MB/s</b></span>
          </div>
        </div>

        <div className="dashboard-user"><span className="dashboard-user-avatar">A</span><span><b>Local workspace</b><small>Browser data</small></span><button aria-label="Open settings" onClick={onSettings}>›</button></div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="dashboard-search"><span>⌕</span><input aria-label="Search Aetheris" placeholder="Search anything... (Ctrl + K)" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="dashboard-top-actions"><button aria-label="Theme">☼</button><button aria-label="Notifications">♧</button><button className="offline-pill"><span className="orbit-mini" /><span><b>Offline Mode</b><small>Your AI. Your Machine.</small></span><em>⌄</em></button><span className="build-label">BUILD 1.0.0</span></div>
        </header>

        <div className="dashboard-scroll">
          <section className="dashboard-hero">
            <div className="hero-copy-left">THINK<br />BUILD<br />AUTOMATE<br />BEYOND</div>
            <div className="hero-art"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-glow" /><div className="hero-sphere"><Image src="/icon.svg" alt="Aetheris" width={64} height={64} /></div><div className="hero-horizon" /></div>
            <div className="hero-copy-right">ONE INTERFACE<br />ALL INTELLIGENCE<br />YOURS</div>
            <div className="dashboard-welcome"><h1>Welcome to <span>Aetheris</span></h1><p>What shall we build today?</p></div>
            <form className="dashboard-prompt" onSubmit={submit}>
              <button type="button" className="prompt-attach" aria-label="Attach file">♧</button>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask Aetheris anything... plan, code, analyse, design, control..." />
              <span className="prompt-tools">✧ ◌</span>
              <button className="prompt-send" aria-label="Send">➤</button>
            </form>
            <div className="hero-shortcuts">
              {["Deep Research", "Code", "Design", "Analyse", "Plan", "Automate", "Hardware", "More"].map((label, index) => <button key={label} onClick={() => index === 0 ? onAsk("Research this deeply with sources: ") : index === 1 ? onAsk("Help me write code for ") : index === 2 ? onMode("studio") : index === 5 ? onMode("workflows") : index === 6 ? onMode("control") : index === 7 ? onMode("apps") : setQuery(`${label}: `)}><span>{["⌕", "⌘", "⌁", "◉", "▣", "⌘", "⌬", "•••"][index]}</span>{label}</button>)}
            </div>
          </section>

          <section className="dashboard-section models-section"><div className="dashboard-section-title"><h2>AI Models</h2><button onClick={() => onMode("providers")}>View All <span>→</span></button></div><div className="model-grid">
            {MODEL_CARDS.map((card, index) => <button key={card.key} className="model-card" onClick={() => onMode("chat")}><BrandTile name={configuredModels[index]?.name ?? card.provider} id={MODEL_LOGO_ID[card.key]} size={30} /><span className="model-card-txt"><b>{configuredModels[index]?.name ?? card.name}</b><small>{configuredModels[index]?.description ?? card.provider}</small></span></button>)}
            <button className="model-card more-models" onClick={() => onMode("providers")}><span>＋</span><b>More Models</b></button>
          </div></section>

          <section className="dashboard-section"><div className="dashboard-section-title"><h2>Quick Actions</h2></div><div className="quick-grid">{QUICK_ACTIONS.map((action) => <button key={action.label} className="quick-card" onClick={() => { if (action.label === "New Chat") onNewChat(); else if (action.prompt) onAsk(action.prompt); else if (action.mode) onMode(action.mode); }}><Icon tone={action.tone}>{action.icon}</Icon><span><b>{action.label}</b><small>{action.sub}</small></span></button>)}</div></section>

          <section className="dashboard-section projects-section"><div className="dashboard-section-title"><h2>Recent Projects</h2><button onClick={() => onMode("chat")}>View All <span>→</span></button></div><div className="project-grid">
            {projectCards.length ? projectCards.map((project, index) => <button key={project.id} className="project-card" onClick={() => onMode("chat")}><div className={`project-thumb project-thumb-${index % 5}`}><span>{["△", "◉", "A", "⌂", "▣"][index % 5]}</span></div><b>{project.name}</b><small>{project.instructions?.slice(0, 30) || "Workspace project"}</small><em>Updated recently</em></button>) : <button className="project-card project-empty" onClick={() => onMode("chat")}><div className="project-thumb project-thumb-new"><span>＋</span></div><b>Start your first project</b><small>Keep chats, files and instructions together</small><em>{convos.length ? `${convos.length} chats ready` : "Create something new"}</em></button>}
            <button className="project-card project-add" onClick={() => onMode("chat")}><span>＋</span><b>New Project</b></button>
          </div></section>
        </div>
      </main>

      <aside className="dashboard-rail">
        <div className="quote-card"><span>“A more intelligent<br />tomorrow, built by you.”</span><small>— AETHERIS</small></div>
        <section className="rail-card system-card"><div className="rail-title"><b>System Status</b><strong>100%</strong></div><div className="status-ring"><span>100%</span></div><div className="status-list"><span><i className="status-icon cyan">△</i>AI Models <b>{modelCount || "24"}/24 <em /></b></span><span><i className="status-icon purple">♧</i>MCP Servers <b>{servers.length || 118} Online <em /></b></span><span><i className="status-icon green">⌬</i>Hardware Devices <b>6 Connected <em /></b></span><span><i className="status-icon lime">▣</i>Local Database <b>Healthy <em /></b></span><span><i className="status-icon red">⌁</i>Internet <b>Optional <em /></b></span></div></section>
        <section className="rail-card inspiration-card"><h3>Today&apos;s Inspiration</h3><div className="inspiration-art" /><p>“Ideas don’t work<br />unless you do.”</p><small>— Aetheris</small></section>
        <section className="rail-card journey-card"><h3>Your Journey</h3><div className="journey-user"><span>R</span><div><b>Level 7</b><small>AI Builder</small><i><em /></i></div></div><div className="xp">420 / 1000 XP</div><ul><li>♧ <span>10 Projects Completed</span></li><li>♙ <span>25 AI Agents Created</span></li><li>♧ <span>118 MCPs Connected</span></li><li>⌘ <span>∞ Possibilities Ahead</span></li></ul><button className="keep-building" onClick={() => onAsk("")}>🚀 Keep Building <span>→</span></button></section>
      </aside>
    </div>
  );
}
