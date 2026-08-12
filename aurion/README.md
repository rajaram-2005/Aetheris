# AURION — Sovereign Cognitive Engine

A production-ready, ChatGPT-like product surface powered by the **C7 cascade** — an original 7-stage processing pipeline that runs entirely on-device. No third-party AI APIs. No API keys. No data leaves your browser.

## What is C7?

C7 is a deterministic, on-device cognitive pipeline with seven stages:

| Stage | Name | What It Does |
|-------|------|-------------|
| 1 | **SENSE** | Tokenization, language detection (en/hi/te/es/fr/de/ta), entity extraction, sentiment analysis, keyword extraction |
| 2 | **ALIGN** | Hybrid intent classifier using cue/regex patterns + TF-IDF cosine similarity against intent prototypes. Classifies 40+ intents |
| 3 | **PLOT** | Maps intent → task-graph steps + style (formal/brief/simple/creative/precise) |
| 4 | **RECALL** | BM25 search over built-in knowledge base (science, CS, India/Hyderabad, programming, etc.), session memory, and file chunks |
| 5 | **THINK** | Recursive-descent math parser (+, -, *, /, ^, %, sqrt, log, sin, cos), unit conversions (km↔mi, kg↔lb, °C↔°F), percentages, quadratic equations, CSV statistics |
| 6 | **WEAVE** | Compositional generators per intent — emails, code (Python/JS/Java/C++/SQL/HTML/Go/bash), poems, stories, quizzes, recipes, travel guides, Visage canvas art |
| 7 | **REFINE** | Safety filtering, vendor voice stripping, honesty enforcement, persona polish |

### Key Algorithms Implemented

- **TF-IDF** — Term Frequency–Inverse Document Frequency for intent classification
- **BM25** — Best Matching 25 for knowledge base retrieval
- **Recursive-descent math parser** — Full expression evaluator with operator precedence
- **Visage** — Canvas2D procedural renderer (aurora, mandala, circuit, stars, poster, flowchart)
- **Translation** — Phrase memory + word lexicon for Hindi, Telugu, Spanish, French, German, Tamil

## No LLM Vendor

AURION does **NOT** use:
- ❌ OpenAI / ChatGPT
- ❌ Anthropic Claude
- ❌ Google Gemini
- ❌ Groq
- ❌ xAI
- ❌ Hugging Face Inference
- ❌ Any third-party LLM / chat API

All "AI" runs in the browser using our own deterministic code. No API keys. No streaming tokens from a vendor.

## Privacy

- Prompts, files, threads stay in the browser (localStorage)
- Nothing is POSTed to an LLM or external server
- Session memory is stored locally only

## Features

- 💬 **Chat** — Conversational interface with multi-thread history
- ✍️ **Write** — Emails, letters, blogs, stories, poems, social posts, ads
- 💻 **Code** — Generate, explain, debug code in Python, JS, Java, C++, SQL, HTML, Go, bash
- 📐 **Math** — Arithmetic, algebra, unit conversions, percentages, quadratic equations, statistics
- 🌐 **Translate** — English ↔ Hindi, Telugu, Spanish, French, German, Tamil
- 📚 **Study** — Quizzes, flashcards, study plans, ELI5 explanations
- 🎨 **Visage** — Canvas2D procedural art (aurora, mandala, circuit, stars, posters, flowcharts)
- 🎨 **Color Palettes** — Generate harmonious palettes for any mood
- 📁 **File Analysis** — Attach txt, md, csv, json, code, images
- 🎤 **Voice** — Web Speech API for voice input
- ⚡ **C7 Inspector** — Live trace of all 7 stages with timing
- 🎯 **Command Palette** — ⌘K for quick actions
- 📋 **Prompt Library** — 40+ curated prompts
- ⚙️ **Settings** — Persona, creativity, length, theme, voice, editable system prompt
- 📤 **Export** — Export threads as Markdown
- 🔒 **Privacy Pill** — Always visible on-device indicator

## Tech Stack

- **Next.js** App Router
- **TypeScript**
- **Tailwind CSS** v4
- **Zero env vars** — deploys to Vercel with no secrets

## Deploy to Vercel

```bash
# Clone the repo
git clone <repo-url>
cd aurion

# Install dependencies
npm install

# Build
npm run build

# Deploy to Vercel
npx vercel
```

Or connect your GitHub repo to [vercel.com](https://vercel.com) and deploy automatically.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── layout.tsx       # Root layout
│   ├── page.tsx          # Home page
│   ├── AurionApp.tsx     # Main app component
│   └── globals.css       # Theme variables + base styles
├── components/
│   ├── Sidebar.tsx       # Left sidebar (brand, threads, skills)
│   ├── ChatArea.tsx      # Center chat panel
│   ├── Composer.tsx      # Message input with file attach + voice
│   ├── MessageBubble.tsx # Message rendering with markdown
│   ├── Inspector.tsx     # Right C7 trace panel
│   ├── SettingsPanel.tsx # Settings modal
│   ├── CommandPalette.tsx # ⌘K command palette
│   ├── PromptLibrary.tsx # Curated prompt library
│   └── SplashScreen.tsx  # Boot splash with C7 cascade animation
├── lib/
│   ├── c7/
│   │   ├── sense.ts      # Stage 1: Tokenize, language, entities
│   │   ├── align.ts      # Stage 2: Intent classification (TF-IDF)
│   │   ├── plot.ts       # Stage 3: Task graph planning
│   │   ├── recall.ts     # Stage 4: Knowledge retrieval (BM25)
│   │   ├── think.ts      # Stage 5: Math parser + conversions
│   │   ├── weave.ts      # Stage 6: Response generators
│   │   ├── refine.ts     # Stage 7: Safety + polish
│   │   └── system.ts     # C7 orchestrator
│   ├── skills/
│   │   ├── code.ts       # Code generators (Python, JS, etc.)
│   │   ├── translate.ts  # Translation lexicons
│   │   └── visage.ts     # Canvas2D procedural renderer
│   ├── kb/
│   │   └── index.ts      # Knowledge base articles
│   └── store.ts          # localStorage persistence
└── types/
    └── index.ts           # TypeScript types
```

## Themes

- 🌌 **Aurora** — Dark navy with mint & gold accents (default)
- ☀️ **Daylight** — Clean, light, professional
- 🖤 **Ink** — Pure black, minimal

## License

MIT
