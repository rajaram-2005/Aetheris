/* ─── Agent Store Modal — Sovereign GPTs & Custom Agent Builder ─── */
"use client";

import { useState, useEffect } from 'react';

interface SovereignAgent {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: string;
  system_prompt: string;
  model_id: string;
  tools_allowed: string[];
  author: string;
  is_featured: boolean;
}

interface AgentStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAgent: (agent: SovereignAgent) => void;
}

export function AgentStoreModal({ isOpen, onClose, onSelectAgent }: AgentStoreModalProps) {
  const [agents, setAgents] = useState<SovereignAgent[]>([]);
  const [activeTab, setActiveTab] = useState<'store' | 'create'>('store');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Custom Agent Builder State
  const [newName, setNewName] = useState('');
  const [newTagline, setNewTagline] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newIcon, setNewIcon] = useState('🤖');
  const [newCategory, setNewCategory] = useState('Custom');

  useEffect(() => {
    if (!isOpen) return;
    fetch('/v1/agents/store')
      .then((r) => r.json())
      .then((res) => {
        if (res.agents) setAgents(res.agents);
      })
      .catch(() => undefined);
  }, [isOpen]);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPrompt.trim()) return;

    try {
      const res = await fetch('/v1/agents/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          tagline: newTagline || 'Custom Sovereign Agent',
          system_prompt: newPrompt,
          icon: newIcon,
          category: newCategory,
          model_id: 'aetheris-prime-v4',
          author: 'User',
        }),
      }).then((r) => r.json());

      if (res.id) {
        setAgents((prev) => [res, ...prev]);
        setActiveTab('store');
        setNewName('');
        setNewTagline('');
        setNewPrompt('');
      }
    } catch {
      // Ignore
    }
  };

  if (!isOpen) return null;

  const categories = ['All', ...Array.from(new Set(agents.map((a) => a.category)))];
  const filtered =
    selectedCategory === 'All'
      ? agents
      : agents.filter((a) => a.category === selectedCategory);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(4, 7, 18, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-5xl h-[88vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(61, 255, 194, 0.3)',
          boxShadow: '0 25px 60px -15px rgba(0, 180, 216, 0.3)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'rgba(15, 22, 43, 0.8)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold shadow"
              style={{
                background: 'linear-gradient(135deg, #00b4d8, #3dffc2)',
                color: '#060914',
              }}
            >
              🤖
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                Sovereign Agents &amp; Custom GPTs Hub
              </h2>
              <p className="text-xs text-gray-400">
                Deploy, customize and run air-gapped specialized AI agents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-gray-700 bg-black/40 p-0.5">
              <button
                onClick={() => setActiveTab('store')}
                className="px-3 py-1 rounded text-xs font-mono transition-colors"
                style={{
                  background: activeTab === 'store' ? 'var(--accent-mint)' : 'transparent',
                  color: activeTab === 'store' ? '#000' : 'var(--text-muted)',
                }}
              >
                Store Marketplace
              </button>
              <button
                onClick={() => setActiveTab('create')}
                className="px-3 py-1 rounded text-xs font-mono transition-colors"
                style={{
                  background: activeTab === 'create' ? 'var(--accent-mint)' : 'transparent',
                  color: activeTab === 'create' ? '#000' : 'var(--text-muted)',
                }}
              >
                + Create Custom Agent
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors hover:opacity-80 ml-2"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'store' ? (
            <>
              {/* Category Pills */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
                    style={{
                      background:
                        selectedCategory === cat
                          ? 'rgba(61, 255, 194, 0.15)'
                          : 'var(--bg-tertiary)',
                      border: `1px solid ${
                        selectedCategory === cat ? 'var(--accent-mint)' : 'var(--border-color)'
                      }`,
                      color:
                        selectedCategory === cat ? 'var(--accent-mint)' : 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Agent Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((agent) => (
                  <div
                    key={agent.id}
                    className="p-5 rounded-2xl border flex flex-col justify-between transition-all hover:scale-[1.02] cursor-pointer"
                    style={{
                      background: agent.is_featured
                        ? 'linear-gradient(135deg, rgba(11, 19, 43, 0.9), rgba(0, 180, 216, 0.1))'
                        : 'var(--bg-tertiary)',
                      borderColor: agent.is_featured
                        ? 'rgba(61, 255, 194, 0.4)'
                        : 'var(--border-color)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                    }}
                    onClick={() => {
                      onSelectAgent(agent);
                      onClose();
                    }}
                  >
                    <div>
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-3xl p-2.5 rounded-xl bg-black/40 border border-white/5 shadow-inner">
                          {agent.icon}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          {agent.category}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-white mb-1 font-mono">
                        {agent.name}
                      </h3>
                      <p className="text-xs text-gray-300 leading-relaxed mb-3">
                        {agent.tagline}
                      </p>
                    </div>

                    <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="text-[10px] font-mono text-gray-400">
                        {agent.model_id}
                      </span>
                      <button
                        className="px-3 py-1 rounded-lg text-xs font-bold transition-all hover:scale-105"
                        style={{ background: 'var(--accent-mint)', color: '#060914' }}
                      >
                        Launch 🚀
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Custom Agent Builder Form */
            <form onSubmit={handleCreateAgent} className="max-w-2xl mx-auto space-y-4 p-6 rounded-2xl border border-gray-800 bg-black/40">
              <h3 className="text-base font-bold text-white font-mono mb-2">
                🛠️ Build a Custom Sovereign Agent
              </h3>

              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="text-xs font-mono text-gray-400 block mb-1">Avatar Icon</label>
                  <input
                    type="text"
                    value={newIcon}
                    onChange={(e) => setNewIcon(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-black border border-gray-700 text-center text-xl text-white outline-none"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-xs font-mono text-gray-400 block mb-1">Agent Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Distributed Systems Auditor"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-black border border-gray-700 text-xs font-mono text-white outline-none focus:border-cyan-400"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-mono text-gray-400 block mb-1">Tagline / Mission</label>
                <input
                  type="text"
                  placeholder="One sentence describing what this agent specializes in..."
                  value={newTagline}
                  onChange={(e) => setNewTagline(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-black border border-gray-700 text-xs font-mono text-white outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-gray-400 block mb-1">System Prompt &amp; Domain Directives</label>
                <textarea
                  rows={6}
                  placeholder="Define precise behavioral rules, domain expertise, and formatting constraints..."
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  className="w-full p-3.5 rounded-lg bg-black border border-gray-700 text-xs font-mono text-white outline-none leading-relaxed focus:border-cyan-400"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('store')}
                  className="px-4 py-2 rounded-lg text-xs font-mono text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg text-xs font-bold font-mono transition-all hover:scale-105"
                  style={{ background: 'var(--accent-mint)', color: '#060914' }}
                >
                  Create &amp; Publish Agent
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
