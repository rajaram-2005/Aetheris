/* ─── AURION App — Main Page (Client Component) ─── */
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Message, Thread, Settings, C7Trace, Theme } from '@/types';
import { runC7, getSystemPrompt } from '@/lib/c7/system';
import {
  getThreads, saveThreads, createThread, getThread, updateThread,
  deleteThread, addMessage, getSettings, saveSettings,
  getCurrentThreadId, setCurrentThreadId, exportThreadAsMarkdown,
  getSessionMemory, addMemoryFact,
} from '@/lib/store';
import { Sidebar } from '@/components/Sidebar';
import { ChatArea } from '@/components/ChatArea';
import { Inspector } from '@/components/Inspector';
import { SettingsPanel } from '@/components/SettingsPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { SplashScreen } from '@/components/SplashScreen';
import { PromptLibrary } from '@/components/PromptLibrary';

export default function AurionApp() {
  const [mounted, setMounted] = useState(false);
  const [booting, setBooting] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [currentThread, setCurrentThread] = useState<Thread | null>(null);
  const [settings, setSettings] = useState<Settings>(getSettings());
  const [processing, setProcessing] = useState(false);
  const [trace, setTrace] = useState<C7Trace | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showPromptLibrary, setShowPromptLibrary] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Mount
  useEffect(() => {
    setMounted(true);
    const loadedThreads = getThreads();
    setThreads(loadedThreads);

    const currentId = getCurrentThreadId();
    if (currentId) {
      const found = loadedThreads.find(t => t.id === currentId);
      if (found) setCurrentThread(found);
    }

    const timer = setTimeout(() => setBooting(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Theme
  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }, [settings.theme, mounted]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        setShowInspector(prev => !prev);
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowPromptLibrary(false);
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleNewThread = useCallback(() => {
    const thread = createThread();
    setThreads(prev => [thread, ...prev.filter(t => t.id !== thread.id)]);
    setCurrentThread(thread);
    setTrace(null);
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    const thread = getThread(id);
    if (thread) {
      setCurrentThread(thread);
      setCurrentThreadId(id);
      setTrace(null);
    }
  }, []);

  const handleDeleteThread = useCallback((id: string) => {
    deleteThread(id);
    const updated = getThreads();
    setThreads(updated);
    if (currentThread?.id === id) {
      setCurrentThread(updated[0] || null);
      setCurrentThreadId(updated[0]?.id || null);
    }
  }, [currentThread]);

  const handleSendMessage = useCallback(async (text: string, attachments?: { name: string; type: string; content: string; size: number }[]) => {
    if (!text.trim() || processing) return;

    let thread = currentThread;
    if (!thread) {
      thread = createThread();
      setThreads(prev => [thread!, ...prev]);
    }

    // Extract session memory facts
    const nameMatch = text.match(/(?:my name is|i am|i'm|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) addMemoryFact('user_name', nameMatch[1]);

    const userMsg: Message = {
      id: `m-${Date.now()}-user`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments,
    };

    addMessage(thread.id, userMsg);
    const updatedThread = getThread(thread.id);
    if (updatedThread) {
      setCurrentThread(updatedThread);
      setThreads(prev => prev.map(t => t.id === updatedThread.id ? updatedThread : t));
    }

    setProcessing(true);
    try {
      const { response, trace: c7trace } = await runC7(
        text,
        settings,
        updatedThread || thread,
        attachments || [],
      );
      setTrace(c7trace);

      const assistantMsg: Message = {
        id: `m-${Date.now()}-assistant`,
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
        trace: c7trace,
      };

      addMessage(thread.id, assistantMsg);
      const finalThread = getThread(thread.id);
      if (finalThread) {
        setCurrentThread(finalThread);
        setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));
      }
    } catch (err) {
      console.error('C7 error:', err);
      const errMsg: Message = {
        id: `m-${Date.now()}-error`,
        role: 'assistant',
        content: 'Something went wrong in the C7 pipeline. Please try again.',
        timestamp: Date.now(),
      };
      addMessage(thread.id, errMsg);
    } finally {
      setProcessing(false);
    }
  }, [currentThread, settings, processing]);

  const handleUpdateSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  const handleExportThread = useCallback(() => {
    if (!currentThread) return;
    const md = exportThreadAsMarkdown(currentThread);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentThread.title.replace(/[^a-z0-9]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentThread]);

  const handleRunPrompt = useCallback((text: string) => {
    setShowPromptLibrary(false);
    setShowCommandPalette(false);
    handleSendMessage(text);
  }, [handleSendMessage]);

  if (!mounted || booting) {
    return <SplashScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Sidebar */}
      <Sidebar
        threads={threads}
        currentThreadId={currentThread?.id || null}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onNewThread={handleNewThread}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPrompts={() => setShowPromptLibrary(true)}
        onExport={handleExportThread}
      />

      {/* Main Chat Area */}
      <ChatArea
        thread={currentThread}
        processing={processing}
        onSendMessage={handleSendMessage}
        onNewThread={handleNewThread}
        onToggleInspector={() => setShowInspector(!showInspector)}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        showInspector={showInspector}
        sidebarOpen={sidebarOpen}
        onRunPrompt={handleRunPrompt}
      />

      {/* C7 Inspector */}
      {showInspector && (
        <Inspector trace={trace} processing={processing} />
      )}

      {/* Modals */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={handleUpdateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onRun={handleRunPrompt}
          threads={threads}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
        />
      )}

      {showPromptLibrary && (
        <PromptLibrary
          onClose={() => setShowPromptLibrary(false)}
          onRun={handleRunPrompt}
        />
      )}
    </div>
  );
}
