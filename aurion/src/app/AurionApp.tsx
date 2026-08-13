/* ─── Aetheris — main application shell ───
 *
 * The UI is a thin client over the unified Hermes runtime & Sovereign Neural Core.
 * Presentation owns local conversation history and rich visual studios.
 */
"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Message, Thread, Settings, HermesRun, Attachment, ModelId, ModeId } from '@/types';
import { runHermes, sendFeedback, getManifest, HermesError } from '@/lib/hermes';
import {
  getThreads, createThread, getThread, deleteThread, addMessage,
  updateMessage, getSettings, saveSettings, getCurrentThreadId,
  setCurrentThreadId, exportThreadAsMarkdown,
} from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { ChatArea } from '@/components/ChatArea';
import { Inspector } from '@/components/Inspector';
import { SettingsPanel } from '@/components/SettingsPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { SplashScreen } from '@/components/SplashScreen';
import { PromptLibrary } from '@/components/PromptLibrary';
import { GalleryModal } from '@/components/GalleryModal';
import { BenchmarkModal } from '@/components/BenchmarkModal';
import { CanvasWorkspace } from '@/components/CanvasWorkspace';
import { AgentStoreModal } from '@/components/AgentStoreModal';
import { DeepResearchModal } from '@/components/DeepResearchModal';
import { ApexLab } from '@/components/ApexLab';
import { GodDeck } from '@/components/GodDeck';

interface RuntimeInfo {
  foundation: string;
  version: string;
  episodes: number;
  knowledge_articles: number;
  online: boolean;
}

/** True once rendered on the client — guards the SSR/hydration gate.
 *  Implemented with useSyncExternalStore so no synchronous setState runs
 *  inside an effect. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export default function AetherisApp() {
  const mounted = useHydrated();
  const [booting, setBooting] = useState(true);
  // Local history is read once at init (SSR-safe) instead of being written by
  // an effect, which avoids a synchronously-set-state render cascade.
  const [threads, setThreads] = useState<Thread[]>(() => getThreads());
  const [currentThread, setCurrentThread] = useState<Thread | null>(() => {
    const currentId = getCurrentThreadId();
    if (!currentId) return null;
    return getThreads().find((t) => t.id === currentId) || null;
  });
  const [settings, setSettings] = useState<Settings>(getSettings());
  const [processing, setProcessing] = useState(false);
  const [run, setRun] = useState<HermesRun | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showBenchmarks, setShowBenchmarks] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [showAgentStore, setShowAgentStore] = useState(false);
  const [showDeepResearch, setShowDeepResearch] = useState(false);
  const [showApexLab, setShowApexLab] = useState(false);
  const [showGodDeck, setShowGodDeck] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  /* Mount: confirm the runtime is reachable (local state was hydrated by the
   * state initializers above). */
  useEffect(() => {
    let cancelled = false;
    getManifest()
      .then((manifest) => {
        if (cancelled) return;
        setRuntime({
          foundation: manifest.foundation,
          version: manifest.version,
          episodes: manifest.episodes,
          knowledge_articles: manifest.knowledge_articles,
          online: true,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRuntime({
            foundation: 'Aetheris Sovereign Neural Core',
            version: '4.2.0',
            episodes: 0,
            knowledge_articles: 0,
            online: false,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setTimeout(() => setBooting(false), 800);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* Theme */
  useEffect(() => {
    if (mounted) document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme, mounted]);

  /* Keyboard shortcuts */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        setShowGallery((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        setShowInspector((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        setShowGodDeck((v) => !v);
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowPromptLibrary(false);
        setShowSettings(false);
        setShowGallery(false);
        setShowBenchmarks(false);
        setShowCanvas(false);
        setShowAgentStore(false);
        setShowDeepResearch(false);
        setShowApexLab(false);
        setShowGodDeck(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const refreshThread = useCallback((id: string) => {
    const updated = getThread(id);
    if (updated) {
      setCurrentThread(updated);
      setThreads(getThreads());
    }
  }, []);

  const handleNewThread = useCallback(() => {
    const thread = createThread();
    setThreads((prev) => [thread, ...prev.filter((t) => t.id !== thread.id)]);
    setCurrentThread(thread);
    setRun(null);
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    const thread = getThread(id);
    if (thread) {
      setCurrentThread(thread);
      setCurrentThreadId(id);
      setRun(null);
    }
  }, []);

  const handleDeleteThread = useCallback(
    (id: string) => {
      deleteThread(id);
      const updated = getThreads();
      setThreads(updated);
      if (currentThread?.id === id) {
        setCurrentThread(updated[0] || null);
        setCurrentThreadId(updated[0]?.id || null);
      }
    },
    [currentThread],
  );

  /** Send a turn: the whole cascade runs server-side. */
  const handleSendMessage = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (!text.trim() || processing) return;

      let thread = currentThread;
      if (!thread) {
        thread = createThread();
        setThreads((prev) => [thread!, ...prev]);
      }
      const threadId = thread.id;

      addMessage(threadId, {
        id: `m-${Date.now()}-user`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        attachments,
      });
      refreshThread(threadId);
      setProcessing(true);

      // Attachments are inlined into the task so the runtime can ground on them.
      let task = text;
      if (attachments?.length) {
        const blocks = attachments
          .map((a) => `--- file: ${a.name} ---\n${a.content.slice(0, 20_000)}`)
          .join('\n\n');
        task = `${text}\n\n[attached files]\n${blocks}`;
      }

      try {
        const result = await runHermes(task, {
          sessionId: threadId,
          useMemory: settings.useMemory,
          learn: settings.learn,
          mode: settings.mode || 'general',
        });
        setRun(result);
        addMessage(threadId, {
          id: `m-${Date.now()}-assistant`,
          role: 'assistant',
          content: result.answer,
          timestamp: Date.now(),
          run: result,
        });
      } catch (error) {
        const message =
          error instanceof HermesError
            ? error.message
            : 'Something went wrong reaching the sovereign neural runtime.';
        addMessage(threadId, {
          id: `m-${Date.now()}-error`,
          role: 'assistant',
          content: message,
          timestamp: Date.now(),
          error: true,
        });
      } finally {
        refreshThread(threadId);
        setProcessing(false);
      }
    },
    [currentThread, processing, settings.useMemory, settings.learn, settings.mode, refreshThread],
  );

  /** Rate an answer — this is the signal the meta-learner trains on. */
  const handleRate = useCallback(
    async (message: Message, reward: number) => {
      if (!currentThread || !message.run?.episode_id) return;
      updateMessage(currentThread.id, message.id, { rated: reward });
      refreshThread(currentThread.id);
      try {
        await sendFeedback(message.run.episode_id, reward);
        const manifest = await getManifest();
        setRuntime((prev) =>
          prev ? { ...prev, episodes: manifest.episodes } : prev,
        );
      } catch {
        /* rating is best-effort; the UI already reflects it */
      }
    },
    [currentThread, refreshThread],
  );

  const handleUpdateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleSelectModel = useCallback(
    (model: ModelId) => {
      const next = { ...settings, model };
      setSettings(next);
      saveSettings(next);
    },
    [settings],
  );

  const handleSelectMode = useCallback(
    (mode: ModeId) => {
      const next = { ...settings, mode };
      setSettings(next);
      saveSettings(next);
    },
    [settings],
  );

  const handleExportThread = useCallback(() => {
    if (!currentThread) return;
    const md = exportThreadAsMarkdown(currentThread);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${currentThread.title.replace(/[^a-z0-9]/gi, '_')}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [currentThread]);

  const handleRunPrompt = useCallback(
    (text: string) => {
      setShowPromptLibrary(false);
      setShowCommandPalette(false);
      setShowGallery(false);
      handleSendMessage(text);
    },
    [handleSendMessage],
  );

  if (!mounted || booting) return <SplashScreen />;

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <Sidebar
        threads={threads}
        currentThreadId={currentThread?.id || null}
        isOpen={sidebarOpen}
        runtime={runtime}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPrompts={() => setShowPromptLibrary(true)}
        onOpenGallery={() => setShowGallery(true)}
        onOpenBenchmarks={() => setShowBenchmarks(true)}
        onOpenCanvas={() => setShowCanvas(true)}
        onOpenAgentStore={() => setShowAgentStore(true)}
        onOpenDeepResearch={() => setShowDeepResearch(true)}
        onOpenApexLab={() => setShowApexLab(true)}
        onOpenGodDeck={() => setShowGodDeck(true)}
        onExport={handleExportThread}
      />

      <ChatArea
        thread={currentThread}
        processing={processing}
        onSendMessage={handleSendMessage}
        onNewThread={handleNewThread}
        onToggleInspector={() => setShowInspector(!showInspector)}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onOpenGallery={() => setShowGallery(true)}
        onOpenBenchmarks={() => setShowBenchmarks(true)}
        onOpenCanvas={() => setShowCanvas(true)}
        onOpenAgentStore={() => setShowAgentStore(true)}
        onOpenDeepResearch={() => setShowDeepResearch(true)}
        onOpenApexLab={() => setShowApexLab(true)}
        onOpenGodDeck={() => setShowGodDeck(true)}
        activeModel={settings.model || 'aetheris-prime-v4'}
        onSelectModel={handleSelectModel}
        activeMode={settings.mode || 'general'}
        onSelectMode={handleSelectMode}
        showInspector={showInspector}
        sidebarOpen={sidebarOpen}
        onRunPrompt={handleRunPrompt}
        onRate={handleRate}
      />

      {showInspector && <Inspector run={run} processing={processing} />}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={handleUpdateSettings}
          onClose={() => setShowSettings(false)}
          onOpenGallery={() => {
            setShowSettings(false);
            setShowGallery(true);
          }}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onRun={handleRunPrompt}
          threads={threads}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onOpenGallery={() => setShowGallery(true)}
          onOpenBenchmarks={() => setShowBenchmarks(true)}
          onOpenCanvas={() => setShowCanvas(true)}
          onOpenAgentStore={() => setShowAgentStore(true)}
          onOpenDeepResearch={() => setShowDeepResearch(true)}
          onOpenApexLab={() => setShowApexLab(true)}
          onOpenGodDeck={() => setShowGodDeck(true)}
          onOpenSettings={() => setShowSettings(true)}
          onSelectMode={handleSelectMode}
        />
      )}

      {showPromptLibrary && (
        <PromptLibrary
          onClose={() => setShowPromptLibrary(false)}
          onRun={handleRunPrompt}
        />
      )}

      {showGallery && (
        <GalleryModal
          isOpen={showGallery}
          onClose={() => setShowGallery(false)}
          onRunPrompt={handleRunPrompt}
        />
      )}

      {showBenchmarks && (
        <BenchmarkModal
          isOpen={showBenchmarks}
          onClose={() => setShowBenchmarks(false)}
        />
      )}

      {showCanvas && (
        <CanvasWorkspace
          isOpen={showCanvas}
          onClose={() => setShowCanvas(false)}
          onRunInChat={handleRunPrompt}
        />
      )}

      {showAgentStore && (
        <AgentStoreModal
          isOpen={showAgentStore}
          onClose={() => setShowAgentStore(false)}
          onSelectAgent={(agent) => {
            handleRunPrompt(`[Activating Agent: ${agent.name}]\n${agent.system_prompt}\n\nHello! How can I assist you with ${agent.category}?`);
          }}
        />
      )}

      {showDeepResearch && (
        <DeepResearchModal
          isOpen={showDeepResearch}
          onClose={() => setShowDeepResearch(false)}
          onRunInChat={handleRunPrompt}
        />
      )}

      {showApexLab && (
        <ApexLab
          isOpen={showApexLab}
          onClose={() => setShowApexLab(false)}
          onRunInChat={handleRunPrompt}
        />
      )}

      {showGodDeck && (
        <GodDeck
          isOpen={showGodDeck}
          onClose={() => setShowGodDeck(false)}
          onRunInChat={handleRunPrompt}
        />
      )}
    </div>
  );
}
