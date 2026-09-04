/**
 * Hand-written documentation. Reference pages (agents, providers, connectors, API) are generated
 * from the live catalogs in ./reference.ts so they never drift from the code.
 */
export interface Guide { slug: string; title: string; section: string; body: string }

export const GUIDES: Guide[] = [
  { slug: "start", section: "Getting started", title: "What is Aetheris One?", body: `
Aetheris One is a **free, open-source AI workspace**. One chat box in front of a mesh of 27 free AI providers with silent failover, a hierarchy of 99 agents, a GitHub coding factory, a media studio, a hub of 100+ MCP apps, live rooms, workflows and more.

**Everything is free for everyone.** There are no plans, credits or payments on the default deployment. The only limits are the upstream providers' free tiers — and the router spreads your requests across all of them.

## 60-second tour
1. **Chat** — type and send. The router picks a provider; if it rate-limits, another one answers. Hover the ✦ pill to see which.
2. **@** — type \`@\` to pick one of 99 specialists (\`@coder\`, \`@tutor\`, \`@tax\`…). Or just describe the task and **Prime** routes it.
3. **/** — slash commands: \`/research\`, \`/arena\`, \`/debate\`, \`/room\`, \`/share\`, \`/workflows\`…
4. **Sidebar modes** — Agents, Coding Factory, Studio, Apps, Gallery, Workflows, Providers.
5. **Sign in** (optional) — Google, GitHub, email or phone. Your chats, memory and settings sync to every device.
`},
  { slug: "chat", section: "Getting started", title: "Chat, models and the provider mesh", body: `
## How routing works
Every request goes through the **omni-router** (\`src/lib/router/router.ts\`):
- Providers are ordered by priority tier (P1 fastest/most generous → P5 keyless community).
- Within a tier the order is shuffled for load-balancing, or **health-ranked** (Bayesian success rate + latency) when priority routing is on (always on now that everything is free).
- On a 429 / 5xx / timeout the router silently moves to the next provider. If tokens were already streamed, the partial answer is kept rather than restarted.
- The provider that answered is shown under each message, with latency and failover count.

## Bring your own keys
You never need a key, but adding free keys raises your limits. Open **Providers** → paste keys. Links open in a new tab (provider pages refuse to load in frames). Keys are stored sealed with \`AETHERIS_SECRET\`.

## Model tiers
\`aetheris-free\` · \`aetheris-lite\` · \`aetheris-pro\` · \`aetheris-pro-max\` · \`aetheris-god\` are *policies*, not single models: each maps to a provider allow-list, a token budget and an agent policy (how many specialists Prime may chain, parallel or pipeline, whether Metis critiques). All tiers are available to everyone.

## Web grounding
Settings → General → Web search: **auto** searches when the question looks time-sensitive, **on** always, **off** never. Uses Tavily if you add a key; otherwise the keyless fallback.

## Images
Paste or drop up to 4 images; vision-capable providers (Groq, Gemini, GitHub Models, OpenRouter, Mistral, Together, SambaNova, NVIDIA) are preferred automatically.

## Keyboard
⌘/Ctrl+K new chat · ⌘/Ctrl+/ focus composer · ⌘/Ctrl+, settings · Esc stop · Shift+Enter newline.
`},
  { slug: "agents", section: "Agents", title: "The agent hierarchy", body: `
Aetheris agents are built on two base layers:

- **Hermes** — the execution base every agent inherits: think first, be exact, use tools deliberately, show work when it matters, never pad.
- **Metis** — the meta-learning layer: after each run it extracts short, transferable lessons that are stored per user and fed into future plans.

## Tiers
| Tier | Agents | Role |
| --- | --- | --- |
| Ultra | **Prime** ✴️ | Reads the task, picks specialists, decides single / pipeline / parallel, synthesises. |
| God | **Hermes** ⚡, **Metis** 🦉 | Direct high-quality answers; critique & lessons. |
| Sub | 96 specialists | Domain experts with their own protocol, skills and aliases. |

## Auto vs forced
- **Auto**: just ask. Prime plans (you see the plan card), specialists run (live per-agent stream), Prime merges.
- **Forced**: \`@coder fix this\` runs only the Engineer. \`@coder @security review this\` forces a two-agent pipeline. Any alias works (\`@sql\`, \`@postgres\`, \`@query\`).
- The **@ picker** (type \`@\`) searches by id, alias, name, domain or skill.

## Where to look
Agents mode lists everyone by domain with skills and aliases, plus the lessons Metis has learned for you (editable). See **Reference → Agents** for the full roster.
`},
  { slug: "ethics", section: "Agents", title: "AI ethics, explainability & transparency", body: `
Aetheris is built so you can always ask **"why?"** and **"should we?"** of the AI.

## /explain — audit any answer
Click **explain** under any assistant message (or type \`/explain\`). The **AI Explainer** (\`@xai\`) reviews the answer from the outside and returns, in a fixed format:

| Section | What you get |
| --- | --- |
| Fact / inference / guess | Each main claim classified in a table |
| Assumptions made | What the answer silently took for granted |
| Confidence | A percentage with the reason |
| Most likely to be wrong | Where and why it could fail (cutoff, ambiguity, pattern-matching) |
| How to verify | The cheapest check you can do yourself |
| Bias & framing check | Whether the question or answer tilted the result |

It is honest about being an outside review: it did not produce the answer and has no privileged view of the model's internals. Endpoint: \`POST /api/explain { question, answer }\` (SSE).

## /ethics — impact assessment
\`/ethics <plan, feature, dataset or text>\` runs the **AI Ethicist** (\`@ai-ethics\`): purpose & affected people, benefits, harms by type with likelihood × severity, consent/transparency/contestability, accountability, ranked mitigations and a go / go-with-conditions / no-go call. Frameworks (EU AI Act tiers, OECD, India's DPDP Act, NITI Aayog Responsible AI) are cited only when relevant.

## @fairness — bias audit
The **Fairness Auditor** checks text, prompts, datasets and model behaviour across gender, caste, religion, region, language, disability, age and class (India-aware), with a findings table, the mechanism, who is disadvantaged, and measurable fixes.

## Transparency built into every answer
- **Provider line** under each message: which provider/model answered, latency and failovers — nothing is hidden behind a single brand.
- **Agent plan card**: when Prime delegates, you see which specialists ran, their briefs, and their status.
- **Tool trail**: every MCP tool call and web search is shown inline.
- **Sources** on research answers; **Metis verdict scorecard** in debates.
- **Metis lessons** are visible and editable in Agents mode — you can see and delete what the system has learned about you.
- **Your data**: guests are local-only; signed-in sync is per-account; export any chat as Markdown; the code is MIT-licensed so anyone can inspect how routing and memory work.

## Learn the concepts
**📚 Learn** in the sidebar (or [/docs/concepts](/docs/concepts)) is a plain-language knowledge base of AI concepts and ethics topics — hallucination, calibration, RAG, bias & fairness metrics, privacy/DPDP, EU AI Act, accountability, human oversight — each with an analogy, a misconception corrected, and a prompt to try. The Explainer and Ethicist link to these pages when they use a concept.

## Limits we state plainly
Answers can be wrong, outdated or biased; the model has no live view of the world unless web search or a tool is used; confidence estimates are themselves estimates. Use \`/explain\` for anything that matters, and verify before acting on medical, legal or financial advice.
`},
  { slug: "workflows", section: "Agents", title: "Workflows", body: `
Workflows chain agents into saved automations. Open **⛓️ Workflows** or type \`/workflows\`.

## Steps
| Kind | What it does |
| --- | --- |
| \`agent\` | Runs one agent with a templated prompt. |
| \`transform\` | Pure text op: \`bullets\`, \`first_line\`, \`extract_json\`, \`strip_code\`, \`upper\`, \`trim:N\`. |
| \`branch\` | Tests a regex against the input; the *else* step is skipped when it matches (and vice-versa). |

## Templates
\`{{input}}\` — the workflow input · \`{{prev}}\` — previous step's output · \`{{steps.<id>}}\` — any earlier step.

## Example
\`\`\`json
[
  { "id": "research", "kind": "agent", "agent": "researcher", "title": "Research", "prompt": "8 key facts about: {{input}}" },
  { "id": "draft",    "kind": "agent", "agent": "writer",     "title": "Draft",    "prompt": "Write 600 words from:\\n{{steps.research}}" },
  { "id": "edit",     "kind": "agent", "agent": "editor",     "title": "Edit",     "prompt": "Tighten this:\\n{{prev}}" }
]
\`\`\`
Runs stream every step; each output is expandable, and **Continue in chat →** carries the final result into a conversation. Public workflows are visible to everyone; duplicate a template to make your own.

## API
\`GET/POST /api/workflows\`, \`GET/DELETE /api/workflows/:id\`, \`POST /api/workflows/:id/run\` (SSE).
`},
  { slug: "debate-arena-research", section: "Agents", title: "Debate, Arena and Deep Research", body: `
## /debate <motion>
Two agents argue for and against over up to 4 rounds; **Metis** adjudicates with a scorecard (evidence, logic, rebuttal, clarity), names a winner and gives a balanced bottom line. Great for decisions and essays. \`POST /api/debate { motion, pro?, con?, rounds? }\`.

## ⚔️ Arena
Send one prompt to several providers side by side, vote for the best, and continue the chat from the winner. Votes feed the health ranking.

## 🔬 Deep Research
Plans research angles, searches the web for each, takes notes, writes a cited report with a sources list. Needs a Tavily key (free) in Settings.
`},
  { slug: "factory", section: "Build", title: "GitHub Coding Factory", body: `
Connect GitHub (OAuth or a fine-grained PAT) and describe a program. The factory:
1. Plans the repository structure.
2. Writes files with the Engineer agent (artifacts you can inspect).
3. Creates the repo, commits, and pushes.
4. Runs tests via GitHub Actions and reports results; on failure it iterates.

**Custom target repo** and long specs (> 2000 chars) are available to everyone.

Tips: be concrete about stack, entry points and how to test. The factory prefers small, working programs over large scaffolds.
`},
  { slug: "studio", section: "Build", title: "Studio: images, speech, video", body: `
- **Images** — free image providers with automatic fallback; describe style, subject, composition. Results appear as artifacts you can download.
- **Speech** — text-to-speech in several voices; pick a voice, paste text, download MP3.
- **Video** — short clips via free/BYOK providers; slower and rate-limited, so keep prompts short.
Use \`/image\` from the chat composer to jump to Studio.
`},
  { slug: "apps", section: "Build", title: "Apps: MCP connectors and the Hub", body: `
**Apps** lists 100+ MCP connectors (Notion, GitHub, Linear, Slack, Stripe, Google Drive…). Enable one and the chat can call its tools when useful; you see each tool call inline.

- **OAuth connectors** open the provider's consent screen in a new tab.
- **Key connectors** ask for a token which is stored sealed.
- **Gateway** connectors are served by Aetheris itself (weather, currency, wiki, etc.).

## The Aetheris Hub
One MCP endpoint that exposes *all* your enabled connectors to any MCP client (Claude Desktop, Cursor, Windsurf…):
\`\`\`json
{ "mcpServers": { "aetheris": { "url": "https://<your-host>/api/mcp/hub", "headers": { "Authorization": "Bearer sk-aeth-…" } } } }
\`\`\`
Tools are namespaced \`<connector>__<tool>\`; \`hub__search_tools\` finds tools by description. Create an API key in Settings → API keys.
`},
  { slug: "rooms-share-sync", section: "Collaborate", title: "Rooms, sharing and sync", body: `
## 👥 Live rooms
Click 👥 (or \`/room\`) to turn the current chat into a room at \`/room/<id>\`. Anyone with the link joins; every message shows who said it; the AI answers for everyone and can address people by name. Start a message with \`//\` (or use *aside*) to talk to humans only. Transport is Server-Sent Events with a polling fallback.

## 🔗 Share
🔗 (or \`/share\`) creates a public, read-only snapshot at \`/s/<id>\` — revocable. Readers can *Continue this chat in Aetheris*, which imports it into their own workspace.

## ☁ Sync
Sign in and your chats, projects, memory and settings merge across devices (newest wins per chat; deletions propagate; memory unions). Guests stay local-only.
`},
  { slug: "accounts", section: "Collaborate", title: "Accounts and sign-in", body: `
\`/login\` offers **Google**, **GitHub**, **email code** and **phone code**. All methods join into one account: a verified email or phone seen via any provider links to the same account, and signing in while already signed in links the new method.

Your anonymous usage is adopted by the account on first sign-in, so nothing is lost.

Sessions are sealed cookies valid 90 days. \`DELETE /api/auth/session\` signs out.

### Admins
Identities listed in \`AETHERIS_ADMIN_EMAILS\` / \`AETHERIS_ADMIN_PHONES\` get \`/admin\` and full access. On the default (free-for-all) deployment everyone already has every feature, so admin mainly matters for moderation and the optional billing system.
`},
  { slug: "api", section: "Developers", title: "OpenAI-compatible API", body: `
Create a key in **Settings → API keys** (\`sk-aeth-…\`) and point any OpenAI SDK at \`/api/v1\`.

\`\`\`bash
curl https://<host>/api/v1/chat/completions \\
  -H "Authorization: Bearer sk-aeth-..." -H "Content-Type: application/json" \\
  -d '{ "model": "aetheris-god", "stream": true, "messages": [{ "role": "user", "content": "Hello" }] }'
\`\`\`

\`\`\`python
from openai import OpenAI
client = OpenAI(base_url="https://<host>/api/v1", api_key="sk-aeth-...")
r = client.chat.completions.create(model="aetheris-pro", messages=[{"role": "user", "content": "Explain MCP"}])
\`\`\`

### Extra body options
| Field | Effect |
| --- | --- |
| \`agents: ["coder","security"]\` | Force specialists (multi-agent pipeline). |
| \`hub: true\` | Give the model access to all your enabled MCP connectors as tools. |
| \`connectors: ["notion"]\` | Restrict tools to specific connectors. |
| \`web: "on" | "off" | "auto"\` | Web grounding. |

\`GET /api/v1/models\` lists the tiers. Streaming uses standard \`data:\` chunks with \`[DONE]\`.
`},
  { slug: "self-host", section: "Developers", title: "Self-hosting and configuration", body: `
\`\`\`bash
git clone https://github.com/rajaram-2005/Aetheris && cd Aetheris
npm install && cp .env.example .env.local
npm run dev            # or: npm run build && npm start
\`\`\`
Works with zero keys. Persistent data lives in \`data/\` (\`AETHERIS_DATA_DIR\`) as JSON; swap \`src/lib/store.ts\` for Postgres/KV by keeping its interface.

### Important variables
| Variable | Purpose |
| --- | --- |
| \`AETHERIS_SECRET\` | Seals cookies, stored keys and credentials. Set in production. |
| \`AETHERIS_ADMIN_EMAILS\` / \`_PHONES\` | Admin identities. |
| \`GOOGLE_CLIENT_ID/SECRET\`, \`GITHUB_CLIENT_ID/SECRET\` | OAuth sign-in (redirects \`…/api/auth/google/callback\`, \`…/api/auth/github/callback\`). |
| \`RESEND_API_KEY\`, \`AUTH_EMAIL_FROM\` | Email codes (dev code printed when unset). |
| \`TWILIO_*\` or \`MSG91_*\` | SMS codes. |
| \`<PROVIDER>_API_KEY\` | Server-wide provider keys (users can also add their own). |
| \`AETHERIS_PAID_PLANS=1\` | Re-enables the optional plan/UPI billing system (off by default). |

Deploys anywhere Next.js runs (Vercel, Render, Fly, Docker). Rooms use an in-process event bus; for multi-instance deployments put a sticky session in front or move the bus to Redis.
`},
  { slug: "contributing", section: "Developers", title: "Contributing", body: `
Aetheris is MIT-licensed. See \`CONTRIBUTING.md\` for the code map.

- **Add a provider**: \`src/lib/router/providers.ts\` (+ adapter in \`adapters.ts\` if not OpenAI-compatible).
- **Add an agent**: \`src/lib/agents/catalog-extended.ts\` — id, aliases, description, ≥3 skills, a real protocol in \`system\`.
- **Add an MCP connector**: \`src/lib/mcp/catalog.ts\`; verify with \`npx tsx scripts/verify-connectors.ts\`.
- **Add gallery prompts**: \`src/lib/gallery/seeds/*.ts\`.
- **Add a language**: \`src/lib/i18n.ts\`.
- Run \`npm run typecheck && npm test\` before a PR.
`},
];
