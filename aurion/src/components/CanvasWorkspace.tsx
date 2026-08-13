/* ─── Canvas Workspace — Interactive Artifacts 2.0 Studio (Claude / Canvas style) ─── */
"use client";

import { useState, useEffect } from 'react';

interface ArtifactVersion {
  version: number;
  content: string;
  summary: string;
  timestamp: number;
}

interface CanvasArtifact {
  id: string;
  title: string;
  artifact_type: string;
  language: string;
  current_version: number;
  versions: ArtifactVersion[];
}

interface CanvasWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
  onRunInChat?: (code: string) => void;
}

export function CanvasWorkspace({ isOpen, onClose, onRunInChat }: CanvasWorkspaceProps) {
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<CanvasArtifact | null>(null);
  const [activeVersion, setActiveVersion] = useState<number>(1);
  const [editedContent, setEditedContent] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'diff'>('preview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/v1/canvas/artifacts')
      .then((r) => r.json())
      .then((res) => {
        if (res.artifacts && res.artifacts.length > 0) {
          setArtifacts(res.artifacts);
          setActiveArtifact(res.artifacts[0]);
          setActiveVersion(res.artifacts[0].current_version);
          const curr = res.artifacts[0].versions.find((v: ArtifactVersion) => v.version === res.artifacts[0].current_version);
          setEditedContent(curr?.content || '');
        }
      })
      .catch(() => undefined);
  }, [isOpen]);

  const handleSelectArtifact = (art: CanvasArtifact) => {
    setActiveArtifact(art);
    setActiveVersion(art.current_version);
    const curr = art.versions.find((v) => v.version === art.current_version);
    setEditedContent(curr?.content || '');
  };

  const handleSelectVersion = (vNum: number) => {
    if (!activeArtifact) return;
    setActiveVersion(vNum);
    const ver = activeArtifact.versions.find((v) => v.version === vNum);
    setEditedContent(ver?.content || '');
  };

  const handleSaveVersion = async () => {
    if (!activeArtifact) return;
    try {
      const res = await fetch(`/v1/canvas/artifacts/${activeArtifact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editedContent,
          summary: `Revision ${activeArtifact.current_version + 1} from Canvas Studio`,
        }),
      }).then((r) => r.json());

      if (res.id) {
        setArtifacts((prev) => prev.map((a) => (a.id === res.id ? res : a)));
        setActiveArtifact(res);
        setActiveVersion(res.current_version);
      }
    } catch {
      // Ignore
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editedContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(4, 7, 18, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-6xl h-[92vh] flex flex-col rounded-2xl overflow-hidden animate-fade-in shadow-2xl"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(61, 255, 194, 0.3)',
          boxShadow: '0 25px 60px -15px rgba(0, 180, 216, 0.3)',
        }}
      >
        {/* Top Header */}
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--border-color)', background: 'rgba(15, 22, 43, 0.8)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow"
              style={{
                background: 'linear-gradient(135deg, #00b4d8, #3dffc2)',
                color: '#060914',
              }}
            >
              🎨
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-mint)' }}>
                Artifacts 2.0 &amp; Interactive Canvas Studio
              </h2>
              <p className="text-[10px] text-gray-400">
                Real-time execution, SVG rendering, code sandboxes &amp; version tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: copied ? 'var(--accent-mint)' : 'var(--text-primary)' }}
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            {onRunInChat && (
              <button
                onClick={() => {
                  onRunInChat(editedContent);
                  onClose();
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                style={{ background: 'var(--accent-mint)', color: '#060914' }}
              >
                ⚡ Run in Chat
              </button>
            )}
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

        {/* Studio Body: Artifacts Sidebar + Main Editor / Preview */}
        <div className="flex-1 flex overflow-hidden">
          {/* Artifact List Sidebar */}
          <div
            className="w-64 border-r flex flex-col overflow-y-auto p-3 space-y-1.5 flex-shrink-0"
            style={{ background: 'rgba(11, 19, 43, 0.5)', borderColor: 'var(--border-color)' }}
          >
            <span className="text-[10px] uppercase font-mono tracking-wider font-semibold text-gray-400 px-2 py-1">
              Active Artifacts
            </span>
            {artifacts.map((art) => (
              <button
                key={art.id}
                onClick={() => handleSelectArtifact(art)}
                className="w-full p-2.5 rounded-xl text-left transition-all"
                style={{
                  background: activeArtifact?.id === art.id ? 'rgba(61,255,194,0.1)' : 'transparent',
                  border: `1px solid ${activeArtifact?.id === art.id ? 'rgba(61,255,194,0.3)' : 'transparent'}`,
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold truncate" style={{ color: activeArtifact?.id === art.id ? 'var(--accent-mint)' : 'var(--text-primary)' }}>
                    {art.title}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-mono uppercase bg-black/40 text-cyan-300">
                    {art.artifact_type}
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 font-mono">
                  v{art.current_version} · {art.language}
                </span>
              </button>
            ))}
          </div>

          {/* Editor & Preview Split Pane */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Artifact Toolbar */}
            <div
              className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-tertiary)' }}
            >
              {/* Version History Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">Version:</span>
                <div className="flex gap-1">
                  {activeArtifact?.versions.map((ver) => (
                    <button
                      key={ver.version}
                      onClick={() => handleSelectVersion(ver.version)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono transition-colors"
                      style={{
                        background: activeVersion === ver.version ? 'var(--accent-mint)' : 'rgba(255,255,255,0.05)',
                        color: activeVersion === ver.version ? '#000' : 'var(--text-secondary)',
                      }}
                    >
                      v{ver.version}
                    </button>
                  ))}
                </div>
              </div>

              {/* View Mode Toggle: Preview vs Code */}
              <div className="flex items-center gap-1 bg-black/40 rounded-lg p-0.5 border border-white/5">
                {(['preview', 'code'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className="px-3 py-1 rounded text-xs font-mono capitalize transition-all"
                    style={{
                      background: viewMode === mode ? 'var(--accent-mint)' : 'transparent',
                      color: viewMode === mode ? '#000' : 'var(--text-muted)',
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <button
                onClick={handleSaveVersion}
                className="px-3 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
                style={{ background: 'rgba(0,180,216,0.2)', color: 'var(--accent-blue)', border: '1px solid rgba(0,180,216,0.4)' }}
              >
                💾 Save as New Version
              </button>
            </div>

            {/* Display Area */}
            <div className="flex-1 overflow-auto p-4">
              {viewMode === 'preview' ? (
                <div className="w-full h-full min-h-[400px] rounded-xl overflow-hidden border border-white/10 bg-black/60 flex items-center justify-center p-4">
                  {activeArtifact?.artifact_type === 'svg' ? (
                    <div
                      className="w-full max-w-2xl aspect-video flex items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: editedContent }}
                    />
                  ) : activeArtifact?.artifact_type === 'html' ? (
                    <iframe
                      srcDoc={editedContent}
                      className="w-full h-full border-0 rounded-lg bg-white"
                      title="Canvas Preview"
                    />
                  ) : (
                    <pre className="text-xs font-mono text-cyan-300 w-full h-full p-4 overflow-auto whitespace-pre-wrap">
                      {editedContent}
                    </pre>
                  )}
                </div>
              ) : (
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full h-full min-h-[450px] p-4 bg-black/80 rounded-xl border border-white/10 text-xs font-mono text-cyan-200 outline-none resize-none leading-relaxed"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
