/* ─── Aetheris — main application shell ───
 *
 * The UI is a thin client over the unified Hermes runtime & Sovereign Neural Core.
 * Presentation owns local conversation history and rich visual studios.
 */
"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Message, Thread, Settings, HermesRun, Attachment, ModelId, ModeId, Theme, AppView } from '@/types';
import { runHermes, sendFeedback, getManifest, generateImage, synthesizeSpeech, HermesError } from '@/lib/hermes';
import {
  getThreads, createThread, getThread, deleteThread, addMessage,
  updateMessage, getSettings, saveSettings, getCurrentThreadId,
  setCurrentThreadId, exportThreadAsMarkdown,
} from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { TopNav } from '@/components/TopNav';
import { HomeView } from '@/components/HomeView';
import { ChatArea } from '@/components/ChatArea';
import { Inspector } from '@/components/Inspector';
import { SettingsPanel } from '@/components/SettingsPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { SplashScreen } from '@/components/SplashScreen';
import { PromptLibrary } from '@/components/PromptLibrary';
import { StudioNexus, StudioChamber } from '@/components/StudioNexus';

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

/** Read the initial view from the URL hash (default: home). */
function getInitialView(): AppView {
  if (typeof window === 'undefined') return 'home';
  return window.location.hash.replace('#', '') === 'workspace' ? 'workspace' : 'home';
}

/** Curated subset of themes the TopNav cycles through. */
const THEME_CYCLE: Theme[] = [
  'aurora',
  'daylight',
  'ink',
  'cyberpunk_neon',
  'matrix_terminal',
  'thamizh_mythos',
  'olympus',
  'blood_moon',
];

export default function AetherisApp() {
  const mounted = useHydrated();
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<AppView>(getInitialView);
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
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [studioChamber, setStudioChamber] = useState<StudioChamber>('one');
  const [imageBusy, setImageBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lastAssistantText, setLastAssistantText] = useState('');
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

  /* Keep the view in sync with the URL hash (deep-linkable + refresh-safe). */
  useEffect(() => {
    const onHash = () => setView(getInitialView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        setStudioChamber('visuals');
        setShowStudio((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        setShowInspector((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        setStudioChamber('god');
        setShowStudio((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        setStudioChamber('one');
        setShowStudio((v) => !v);
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowPromptLibrary(false);
        setShowSettings(false);
        setShowStudio(false);
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
        setLastAssistantText(result.answer);
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

  const handleSelectTheme = useCallback(
    (theme: Theme) => {
      const next = { ...settings, theme };
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
      setShowStudio(false);
      handleSendMessage(text);
    },
    [handleSendMessage],
  );

  /** Append an assistant message to the current thread (for media results). */
  const appendAssistantMessage = useCallback(
    (content: string, run?: HermesRun) => {
      let thread = currentThread;
      if (!thread) {
        thread = createThread();
        setThreads((prev) => [thread!, ...prev]);
      }
      const id = thread.id;
      addMessage(id, {
        id: `m-${Date.now()}-assistant`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        run,
      });
      setLastAssistantText(content);
      refreshThread(id);
    },
    [currentThread, refreshThread],
  );

  /** Generate an image (layered provider) and surface it in the chat. */
  const handleGenerateImage = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || imageBusy) return;
      setImageBusy(true);
      appendAssistantMessage(`🎨 Generating an image for: *${prompt.trim()}*…`);
      try {
        const result = await generateImage(prompt.trim());
        const md = `![generated image](${result.artifact.url})\n\n**${result.detail?.provider || 'Aetheris'}** · ${result.detail?.model || ''}`;
        appendAssistantMessage(md);
      } catch (e) {
        appendAssistantMessage(
          '⚠️ ' + (e instanceof Error ? e.message : 'Image generation failed.'),
        );
      } finally {
        setImageBusy(false);
      }
    },
    [appendAssistantMessage, imageBusy],
  );

  /** Speak text aloud via text-to-speech (offline formant by default). */
  const handleSpeak = useCallback(
    async (text: string) => {
      if (!text.trim() || speaking) return;
      setSpeaking(true);
      try {
        const result = await synthesizeSpeech(text.trim());
        const audio = new Audio(result.artifact.url);
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => setSpeaking(false);
        audio.play();
      } catch (e) {
        setSpeaking(false);
        appendAssistantMessage(
          '⚠️ TTS failed: ' + (e instanceof Error ? e.message : 'Could not synthesize speech.'),
        );
      }
    },
    [speaking, appendAssistantMessage],
  );

  const handleSpeakLast = useCallback(() => {
    if (lastAssistantText.trim()) handleSpeak(lastAssistantText);
  }, [lastAssistantText, handleSpeak]);

  /* ─── Single-app navigation (Home ⇄ Workspace) ─── */
  const navigate = useCallback((next: AppView) => {
    setView(next);
    if (typeof window !== 'undefined' && window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
  }, []);

  const handleLaunch = useCallback(() => navigate('workspace'), [navigate]);

  const handleCycleTheme = useCallback(() => {
    const index = THEME_CYCLE.indexOf(settings.theme);
    const next = THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
    handleSelectTheme(next);
  }, [settings.theme, handleSelectTheme]);

  const handleHomeTryModel = useCallback(
    (model: ModelId) => {
      handleSelectModel(model);
      navigate('workspace');
    },
    [handleSelectModel, navigate],
  );

  const handleHomeTryMode = useCallback(
    (mode: ModeId) => {
      handleSelectMode(mode);
      navigate('workspace');
    },
    [handleSelectMode, navigate],
  );

  const handleHomeGenerate = useCallback(
    (prompt: string) => {
      setShowStudio(false);
      navigate('workspace');
      handleGenerateImage(prompt);
    },
    [navigate, handleGenerateImage],
  );

  const handleOpenStudio = useCallback((chamber: StudioChamber = 'one') => {
    setStudioChamber(chamber);
    setShowStudio(true);
  }, []);

  const handleStudioRun = useCallback(
    (text: string) => {
      setShowStudio(false);
      navigate('workspace');
      handleRunPrompt(text);
    },
    [navigate, handleRunPrompt],
  );

  const handleHomeRunPrompt = useCallback(
    (text: string) => {
      navigate('workspace');
      handleRunPrompt(text);
    },
    [navigate, handleRunPrompt],
  );

  if (!mounted || booting) return <SplashScreen />;

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <TopNav
        view={view}
        onNavigate={navigate}
        runtime={runtime}
        onOpenGodDeck={() => handleOpenStudio('god')}
        onOpenStudio={() => handleOpenStudio('one')}
        onOpenSettings={() => setShowSettings(true)}
        onCycleTheme={handleCycleTheme}
      />

      {view === 'home' ? (
        <HomeView
          online={!!runtime?.online}
          onLaunch={handleLaunch}
          onTryModel={handleHomeTryModel}
          onTryMode={handleHomeTryMode}
          onOpenResearch={() => handleOpenStudio('research')}
          onOpenStudio={handleOpenStudio}
          onGenerateImage={handleHomeGenerate}
          onRunPrompt={handleHomeRunPrompt}
        />
      ) : (
      <div className="flex flex-1 overflow-hidden">
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
        onOpenGallery={() => handleOpenStudio('visuals')}
        onOpenBenchmarks={() => handleOpenStudio('arena')}
        onOpenCanvas={() => handleOpenStudio('canvas')}
        onOpenAgentStore={() => handleOpenStudio('agents')}
        onOpenDeepResearch={() => handleOpenStudio('research')}
        onOpenApexLab={() => handleOpenStudio('apex')}
        onOpenGodDeck={() => handleOpenStudio('god')}
        onOpenSkills={() => handleOpenStudio('skills')}
        onOpenIntegrations={() => handleOpenStudio('connect')}
        onOpenResources={() => handleOpenStudio('models')}
        onOpenMythology={() => handleOpenStudio('mythos')}
        onOpenResearchEvolution={() => handleOpenStudio('research')}
        onOpenStudio={() => handleOpenStudio('one')}
        onExport={handleExportThread}
      />

      <ChatArea
        thread={currentThread}
        processing={processing}
        onSendMessage={handleSendMessage}
        onNewThread={handleNewThread}
        onToggleInspector={() => setShowInspector(!showInspector)}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onOpenGallery={() => handleOpenStudio('visuals')}
        onOpenBenchmarks={() => handleOpenStudio('arena')}
        onOpenCanvas={() => handleOpenStudio('canvas')}
        onOpenAgentStore={() => handleOpenStudio('agents')}
        onOpenDeepResearch={() => handleOpenStudio('research')}
        onOpenApexLab={() => handleOpenStudio('apex')}
        onOpenGodDeck={() => handleOpenStudio('god')}
        onOpenSkills={() => handleOpenStudio('skills')}
        onOpenIntegrations={() => handleOpenStudio('connect')}
        onOpenResources={() => handleOpenStudio('models')}
        onOpenMythology={() => handleOpenStudio('mythos')}
        activeModel={settings.model || 'aetheris-prime-v4'}
        onSelectModel={handleSelectModel}
        activeMode={settings.mode || 'general'}
        onSelectMode={handleSelectMode}
        showInspector={showInspector}
        sidebarOpen={sidebarOpen}
        onRunPrompt={handleRunPrompt}
        onRate={handleRate}
        onGenerateImage={handleGenerateImage}
        onSpeak={handleSpeak}
        onSpeakLast={handleSpeakLast}
        canSpeakLast={!!lastAssistantText}
        imageBusy={imageBusy}
        speaking={speaking}
      />

      {showInspector && <Inspector run={run} processing={processing} />}
      </div>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={handleUpdateSettings}
          onClose={() => setShowSettings(false)}
          onOpenGallery={() => {
            setShowSettings(false);
            handleOpenStudio('visuals');
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
          onOpenGallery={() => handleOpenStudio('visuals')}
          onOpenBenchmarks={() => handleOpenStudio('arena')}
          onOpenCanvas={() => handleOpenStudio('canvas')}
          onOpenAgentStore={() => handleOpenStudio('agents')}
          onOpenDeepResearch={() => handleOpenStudio('research')}
          onOpenApexLab={() => handleOpenStudio('apex')}
          onOpenGodDeck={() => handleOpenStudio('god')}
          onOpenStudio={() => handleOpenStudio('one')}
          onOpenSettings={() => setShowSettings(true)}
          onSelectMode={handleSelectMode}
          onSelectTheme={handleSelectTheme}
        />
      )}

      {showPromptLibrary && (
        <PromptLibrary
          onClose={() => setShowPromptLibrary(false)}
          onRun={handleRunPrompt}
        />
      )}

      <StudioNexus
        isOpen={showStudio}
        chamber={studioChamber}
        onClose={() => setShowStudio(false)}
        onRunInChat={handleStudioRun}
        onGenerateImage={handleHomeGenerate}
      />
    </div>
  );
}
