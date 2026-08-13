/* ─── GalleryModal — Mind-Blowing Visual Assets & Neural Canvas Studio ─── */
"use client";

import { useState, useEffect } from 'react';
import { GalleryImage } from '@/types';
import { getGalleryImages } from '@/lib/hermes';

interface GalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunPrompt: (prompt: string) => void;
}

const FALLBACK_IMAGES: GalleryImage[] = [
  {
    id: 'hero-neural-core',
    url: '/images/hero-neural-core.png',
    title: 'Sovereign Neural Core v4.0',
    tagline: 'Quantum Synaptic Crystal Lattice',
    prompt: 'A breathtaking ultra-high-definition 8k futuristic neural quantum AI core, glowing cybernetic crystal lattice with intricate luminous synaptic connections, neon cyan, electric teal, and deep cosmic indigo filaments pulsing with energy.',
    category: 'Core Architecture',
    tags: ['Neural Core', 'Quantum Lattice', 'Sovereign AI', 'Obsidian Glass'],
    dimensions: '1024x1024',
  },
  {
    id: 'multi-agent-nexus',
    url: '/images/multi-agent-nexus.png',
    title: 'Multi-Agent MoE Holographic Matrix',
    tagline: 'Decentralized Swarm Orchestration',
    prompt: 'An extraordinary isometric 3D visualization of an autonomous multi-agent AI neural orchestrator, glowing holographic floating interface nodes, futuristic cybernetic data streams, iridescent purple and electric mint lasers connecting floating cognitive modules.',
    category: 'Multi-Agent Systems',
    tags: ['Agent Swarm', 'Mixture of Experts', 'Holographic HUD', 'Cognition Nodes'],
    dimensions: '1024x1024',
  },
  {
    id: 'neural-canvas-synthesis',
    url: '/images/neural-canvas-synthesis.png',
    title: 'Neural Canvas & Multimodal Synthesis',
    tagline: 'High-Dimensional Generative Flow',
    prompt: 'A mind-blowing surreal generative AI visual synthesis art piece, iridescent liquid chrome and glowing neon particles morphing into futuristic digital geometry, vibrant teal, magenta and gold lighting.',
    category: 'Generative Media',
    tags: ['Generative Art', 'Latent Canvas', 'Procedural Vector', 'Fluid Gradients'],
    dimensions: '1024x1024',
  },
  {
    id: 'deep-reasoning-matrix',
    url: '/images/deep-reasoning-matrix.png',
    title: 'Aetheris Omni Deep Reasoning Matrix',
    tagline: 'Recursive Mathematical Proof Engine',
    prompt: 'A stunning futuristic quantum reasoning matrix, glowing mathematical geometric mandalas and synaptic decision trees floating in dark space, electric blue and neon gold highlights.',
    category: 'Reasoning & Math',
    tags: ['Formal Proofs', 'Tree Search', 'Chain of Thought', 'Synaptic Graph'],
    dimensions: '1024x1024',
  },
  {
    id: 'sovereign-shield-privacy',
    url: '/images/sovereign-shield-privacy.png',
    title: 'Cryptographic Sovereign Shield',
    tagline: 'Air-Gapped Private Intelligence',
    prompt: 'A hyper-detailed futuristic cybernetic sovereign privacy shield, glowing cryptographic geometric rings, holographic data lock, neon mint and midnight indigo refraction.',
    category: 'Security & Privacy',
    tags: ['Zero Network', 'Air-Gapped', 'No Cloud APIs', 'Local Privacy'],
    dimensions: '1024x1024',
  },
  {
    id: 'aetheris-banner',
    url: '/images/aetheris-banner.png',
    title: 'Aetheris Cosmic Intelligence Matrix',
    tagline: 'Infinite Knowledge · Refined Synthesis',
    prompt: 'Cinematic wide cyberpunk banner of Aetheris sovereign intelligence matrix, glowing neural networks spreading across a dark cosmic horizon, neon teal and deep violet light trails.',
    category: 'Brand & Atmosphere',
    tags: ['Cosmic Indigo', 'Electric Teal', 'Wide Horizon', 'Cyberpunk'],
    dimensions: '1024x1024',
  },
];

const CATEGORIES = [
  'All',
  'Core Architecture',
  'Multi-Agent Systems',
  'Generative Media',
  'Reasoning & Math',
  'Security & Privacy',
];

export function GalleryModal({ isOpen, onClose, onRunPrompt }: GalleryModalProps) {
  const [images, setImages] = useState<GalleryImage[]>(FALLBACK_IMAGES);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeImage, setActiveImage] = useState<GalleryImage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    getGalleryImages()
      .then((res) => {
        if (res.images && res.images.length > 0) {
          setImages(res.images);
        }
      })
      .catch(() => setImages(FALLBACK_IMAGES));
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered =
    selectedCategory === 'All'
      ? images
      : images.filter((img) => img.category === selectedCategory);

  const handleCopyPrompt = (img: GalleryImage) => {
    navigator.clipboard.writeText(img.prompt);
    setCopiedId(img.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleUsePrompt = (prompt: string) => {
    onRunPrompt(prompt);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: 'rgba(4, 7, 18, 0.85)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(61, 255, 194, 0.25)',
          boxShadow: '0 25px 60px -15px rgba(0, 180, 216, 0.25)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'rgba(15, 22, 43, 0.8)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #00b4d8, #3dffc2)',
                color: '#060914',
              }}
            >
              🎨
            </div>
            <div>
              <h2
                className="text-lg font-bold tracking-tight"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}
              >
                Neural Visual Studio &amp; UI Design Gallery
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Mind-blowing generative visual assets powered by the Aetheris Vision-Gen &amp; Neural Engine
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-all hover:opacity-80"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Visual Prompt Synthesizer Bar */}
          <div
            className="p-4 rounded-xl relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 180, 216, 0.08), rgba(61, 255, 194, 0.04))',
              border: '1px solid rgba(61, 255, 194, 0.2)',
            }}
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-mono)' }}>
                  ✨ Generate or Remix Neural Visuals
                </label>
                <input
                  type="text"
                  placeholder="Describe a mind-blowing UI visual, cybernetic core, or 3D neural scene…"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customPrompt.trim()) {
                      handleUsePrompt(`Generate an image: ${customPrompt}`);
                    }
                  }}
                  className="w-full px-4 py-2.5 rounded-lg text-sm bg-black/40 border outline-none transition-all focus:border-cyan-400"
                  style={{
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-ui)',
                  }}
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={() => {
                    if (customPrompt.trim()) {
                      handleUsePrompt(`Generate an image: ${customPrompt}`);
                    }
                  }}
                  className="px-5 py-2.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                  style={{
                    background: 'var(--accent-mint)',
                    color: '#060914',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  🚀 Generate in Chat
                </button>
              </div>
            </div>

            {/* Quick Prompt Chips */}
            <div className="flex flex-wrap gap-2 mt-3 items-center">
              <span className="text-[11px] font-mono text-gray-400">Presets:</span>
              {[
                'Cybernetic Holographic Quantum Core',
                'Futuristic Isometric Agent Matrix',
                'Iridescent Neural Fluid Synthesis',
                'Air-gapped Cryptographic Cyber Shield',
              ].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setCustomPrompt(preset)}
                  className="text-[11px] px-2.5 py-1 rounded-full transition-colors hover:border-teal-400"
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all"
                style={{
                  background:
                    selectedCategory === cat
                      ? 'rgba(61, 255, 194, 0.15)'
                      : 'var(--bg-tertiary)',
                  border: `1px solid ${
                    selectedCategory === cat
                      ? 'var(--accent-mint)'
                      : 'var(--border-color)'
                  }`,
                  color:
                    selectedCategory === cat
                      ? 'var(--accent-mint)'
                      : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Image Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((img) => (
              <div
                key={img.id}
                className="group rounded-xl overflow-hidden flex flex-col transition-all duration-300 hover:scale-[1.02] cursor-pointer"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                }}
                onClick={() => setActiveImage(img)}
              >
                {/* Image Container with Ambient Glow */}
                <div className="relative aspect-video w-full overflow-hidden bg-black/60">
                  <img
                    src={img.url}
                    alt={img.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-108"
                    loading="lazy"
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-30 transition-opacity"
                  />
                  <span
                    className="absolute top-2.5 right-2.5 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold"
                    style={{
                      background: 'rgba(0, 0, 0, 0.7)',
                      color: 'var(--accent-mint)',
                      border: '1px solid rgba(61, 255, 194, 0.4)',
                    }}
                  >
                    {img.category}
                  </span>
                </div>

                {/* Details */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h3
                      className="text-sm font-bold truncate mb-0.5"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {img.title}
                    </h3>
                    <p className="text-xs mb-3" style={{ color: 'var(--accent-blue)' }}>
                      {img.tagline}
                    </p>
                    <p
                      className="text-xs line-clamp-2 mb-3 leading-relaxed"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {img.prompt}
                    </p>
                  </div>

                  {/* Tags & Action */}
                  <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex flex-wrap gap-1 max-w-[65%]">
                      {img.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUsePrompt(`Generate an image: ${img.prompt}`);
                      }}
                      className="text-xs font-semibold px-2.5 py-1 rounded-md transition-all hover:opacity-90"
                      style={{
                        background: 'rgba(61,255,194,0.12)',
                        border: '1px solid rgba(61,255,194,0.3)',
                        color: 'var(--accent-mint)',
                      }}
                    >
                      Use ↗
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lightbox Modal for Active Image */}
      {activeImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          onClick={() => setActiveImage(null)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl overflow-hidden animate-fade-in"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid rgba(61,255,194,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative aspect-video w-full bg-black">
              <img
                src={activeImage.url}
                alt={activeImage.title}
                className="w-full h-full object-contain"
              />
              <button
                onClick={() => setActiveImage(null)}
                className="absolute top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3
                    className="text-xl font-bold"
                    style={{ color: 'var(--accent-mint)', fontFamily: 'var(--font-display)' }}
                  >
                    {activeImage.title}
                  </h3>
                  <p className="text-sm font-medium" style={{ color: 'var(--accent-blue)' }}>
                    {activeImage.tagline}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopyPrompt(activeImage)}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      color: copiedId === activeImage.id ? 'var(--accent-mint)' : 'var(--text-primary)',
                    }}
                  >
                    {copiedId === activeImage.id ? '✓ Copied' : '📋 Copy Prompt'}
                  </button>
                  <button
                    onClick={() => handleUsePrompt(`Generate an image: ${activeImage.prompt}`)}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    style={{
                      background: 'var(--accent-mint)',
                      color: '#060914',
                    }}
                  >
                    🚀 Run in Chat
                  </button>
                </div>
              </div>

              <div
                className="p-3.5 rounded-xl text-xs leading-relaxed"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                <span className="font-mono text-[10px] uppercase tracking-wider block text-gray-400 mb-1">
                  Full Synthesis Prompt
                </span>
                {activeImage.prompt}
              </div>

              <div className="flex flex-wrap gap-2 items-center text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>Tags:</span>
                {activeImage.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded font-mono text-[10px]"
                    style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
                  >
                    #{t}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[10px]">
                  Resolution: {activeImage.dimensions} · In-House Neural Synthesis
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
