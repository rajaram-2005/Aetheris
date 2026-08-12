/* ─── Prompt Library — Modal with curated prompts ─── */
"use client";

import { useState } from 'react';

interface PromptLibraryProps {
  onClose: () => void;
  onRun: (text: string) => void;
}

interface Prompt {
  id: string;
  icon: string;
  title: string;
  prompt: string;
  category: string;
}

const PROMPTS: Prompt[] = [
  // Identity
  { id: 'who', icon: '🤖', title: 'Who are you?', prompt: 'Who are you?', category: 'Identity' },
  { id: 'what', icon: '❓', title: 'What can you do?', prompt: 'What can you do?', category: 'Identity' },
  { id: 'how', icon: '⚙️', title: 'How do you work?', prompt: 'How do you work? Explain the C7 cascade.', category: 'Identity' },

  // Write
  { id: 'email', icon: '📧', title: 'Professional email', prompt: 'Write a professional email to my manager requesting a meeting to discuss project progress.', category: 'Write' },
  { id: 'letter', icon: '✉️', title: 'Formal letter', prompt: 'Write a formal complaint letter about a delayed delivery.', category: 'Write' },
  { id: 'blog', icon: '📝', title: 'Blog post', prompt: 'Write a blog post about the benefits of learning to code as a student.', category: 'Write' },
  { id: 'resume', icon: '📄', title: 'Resume template', prompt: 'Help me build a resume for a software engineer position.', category: 'Write' },
  { id: 'cover', icon: '💌', title: 'Cover letter', prompt: 'Write a cover letter for a frontend developer position at a tech startup.', category: 'Write' },
  { id: 'poem', icon: '🎭', title: 'Poem', prompt: 'Write a poem about the city of Hyderabad at sunset.', category: 'Write' },
  { id: 'story', icon: '📖', title: 'Short story', prompt: 'Write a short science fiction story about a programmer who discovers their code is sentient.', category: 'Write' },
  { id: 'social', icon: '📱', title: 'LinkedIn post', prompt: 'Write a LinkedIn post about the importance of continuous learning in tech.', category: 'Write' },

  // Code
  { id: 'py-sort', icon: '🐍', title: 'Python sorting', prompt: 'Write a Python implementation of merge sort with comments.', category: 'Code' },
  { id: 'react-comp', icon: '⚛️', title: 'React component', prompt: 'Write a React component for a searchable dropdown with TypeScript.', category: 'Code' },
  { id: 'sql-query', icon: '🗄️', title: 'SQL query', prompt: 'Write a SQL query to find the top 10 customers by total order value, with their order count.', category: 'Code' },
  { id: 'api', icon: '🌐', title: 'REST API', prompt: 'Write a FastAPI server with CRUD endpoints for a todo app.', category: 'Code' },
  { id: 'html-landing', icon: '🎨', title: 'Landing page', prompt: 'Write an HTML landing page with a hero section, features grid, and CTA button. Dark theme.', category: 'Code' },

  // Math
  { id: 'math-basic', icon: '➕', title: 'Calculate', prompt: 'What is 247 × 38 + 1592 / 4?', category: 'Math' },
  { id: 'quadratic', icon: '📐', title: 'Quadratic equation', prompt: 'Solve x² + 5x + 6 = 0', category: 'Math' },
  { id: 'convert-units', icon: '🔄', title: 'Unit conversion', prompt: 'Convert 72°F to Celsius', category: 'Math' },
  { id: 'percent', icon: '💯', title: 'Percentage', prompt: 'What is 15% of 2500?', category: 'Math' },
  { id: 'stats', icon: '📊', title: 'Statistics', prompt: 'Calculate the mean, median, and standard deviation of: 12, 15, 18, 22, 25, 30, 35, 40', category: 'Math' },

  // Study
  { id: 'quiz-photosynthesis', icon: '🌿', title: 'Quiz: Photosynthesis', prompt: 'Quiz me on photosynthesis', category: 'Study' },
  { id: 'quiz-gravity', icon: '🍎', title: 'Quiz: Gravity', prompt: 'Quiz me on gravity and general relativity', category: 'Study' },
  { id: 'flashcards-dna', icon: '🧬', title: 'Flashcards: DNA', prompt: 'Create flashcards about DNA and genetics', category: 'Study' },
  { id: 'jee-plan', icon: '📚', title: 'JEE study plan', prompt: 'Create a study plan for JEE preparation', category: 'Study' },
  { id: 'eli5-quantum', icon: '🧒', title: 'ELI5: Quantum', prompt: 'ELI5 quantum mechanics', category: 'Study' },

  // Translate
  { id: 'hi-translate', icon: '🇮🇳', title: 'English → Hindi', prompt: 'Translate "How are you? I am fine." to Hindi', category: 'Translate' },
  { id: 'te-translate', icon: '🇮🇳', title: 'English → Telugu', prompt: 'Translate "Good morning, how are you?" to Telugu', category: 'Translate' },
  { id: 'es-translate', icon: '🇪🇸', title: 'English → Spanish', prompt: 'Translate "Where is the nearest restaurant?" to Spanish', category: 'Translate' },
  { id: 'fr-translate', icon: '🇫🇷', title: 'English → French', prompt: 'Translate "Thank you very much, have a good day" to French', category: 'Translate' },

  // Visage
  { id: 'aurora', icon: '🌌', title: 'Aurora poster', prompt: 'Draw an aurora poster', category: 'Visage' },
  { id: 'mandala', icon: '🔮', title: 'Mandala', prompt: 'Draw a mandala pattern', category: 'Visage' },
  { id: 'circuit', icon: '🔌', title: 'Circuit board', prompt: 'Draw a circuit board pattern', category: 'Visage' },
  { id: 'stars', icon: '⭐', title: 'Star field', prompt: 'Draw a star field', category: 'Visage' },
  { id: 'c7-flow', icon: '📊', title: 'C7 flowchart', prompt: 'Draw a C7 flowchart diagram', category: 'Visage' },
  { id: 'palette', icon: '🎨', title: 'Color palette', prompt: 'Generate an aurora color palette', category: 'Visage' },

  // Lifestyle
  { id: 'biryani', icon: '🍚', title: 'Biryani recipe', prompt: 'Give me a Hyderabadi dum biryani recipe', category: 'Lifestyle' },
  { id: 'hyderabad', icon: '🏛️', title: 'Hyderabad guide', prompt: 'Weekend plan for Hyderabad', category: 'Lifestyle' },
  { id: 'health-tips', icon: '💪', title: 'Health tips', prompt: 'Give me general nutrition and health tips for a college student', category: 'Lifestyle' },
];

export function PromptLibrary({ onClose, onRun }: PromptLibraryProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = [...new Set(PROMPTS.map(p => p.category))];

  const filtered = PROMPTS.filter(p => {
    const matchSearch = !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.prompt.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !activeCategory || p.category === activeCategory;
    return matchSearch && matchCategory;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] rounded-2xl overflow-hidden animate-fade-in flex flex-col"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
              📋 Prompt Library
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search prompts…"
            className="w-full px-3 py-2 rounded-lg text-sm bg-transparent outline-none"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
            autoFocus
          />
        </div>

        {/* Category filters */}
        <div className="px-5 py-2 flex gap-1.5 overflow-x-auto border-b" style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={() => setActiveCategory(null)}
            className="px-3 py-1 rounded-full text-xs whitespace-nowrap"
            style={{
              background: !activeCategory ? 'rgba(61,255,194,0.1)' : 'var(--bg-tertiary)',
              border: `1px solid ${!activeCategory ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
              color: !activeCategory ? 'var(--accent-mint)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className="px-3 py-1 rounded-full text-xs whitespace-nowrap"
              style={{
                background: activeCategory === cat ? 'rgba(61,255,194,0.1)' : 'var(--bg-tertiary)',
                border: `1px solid ${activeCategory === cat ? 'rgba(61,255,194,0.3)' : 'var(--border-color)'}`,
                color: activeCategory === cat ? 'var(--accent-mint)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Prompt list */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map(prompt => (
            <button
              key={prompt.id}
              onClick={() => { onRun(prompt.prompt); onClose(); }}
              className="flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01]"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
            >
              <span className="text-lg mt-0.5">{prompt.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
                  {prompt.title}
                </p>
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {prompt.prompt}
                </p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 text-center py-8">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No matching prompts</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t text-center text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Click a prompt to run it instantly · {PROMPTS.length} prompts available
        </div>
      </div>
    </div>
  );
}
