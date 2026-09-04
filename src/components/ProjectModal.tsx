"use client";

import { useState } from "react";
import { fileToText, type Project, type ProjectFile } from "./store";

export default function ProjectModal({ project, onSave, onClose }: { project: Project | null; onSave: (p: Project) => void; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [files, setFiles] = useState(project?.files ?? []);
  const [err, setErr] = useState<string | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const added: ProjectFile[] = [];
    for (const f of Array.from(list)) {
      const t = await fileToText(f);
      if (t) added.push(t); else setErr(`Skipped ${f.name}: only text-like files up to 2 MB are supported.`);
    }
    setFiles((cur) => [...cur.filter((c) => !added.some((a) => a.name === c.name)), ...added].slice(0, 20));
  };
  const total = files.reduce((n, f) => n + f.size, 0);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3 style={{ marginTop: 0 }}>{project ? "Edit project" : "New project"}</h3>
        <div className="settings">
          <label className="field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aetheris launch, Thesis, Client X" /></label>
          <label className="field">
            <span>Custom instructions</span>
            <textarea rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="How should Aetheris behave in this project? Tone, stack, constraints, audience…" />
          </label>
          <div className="field">
            <span>Knowledge files <small>({files.length}/20 · {(total / 1024).toFixed(0)} KB)</small></span>
            <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
              <input type="file" multiple onChange={(e) => addFiles(e.target.files)} />
              <small>Drop text/code/markdown/CSV/JSON files. Their contents are given to the model in every chat of this project (≈40k chars used per request).</small>
            </div>
            {files.length > 0 && (
              <div className="files">
                {files.map((f) => <span key={f.name} className="chip">{f.name} <button className="link" onClick={() => setFiles(files.filter((x) => x.name !== f.name))}>✕</button></span>)}
              </div>
            )}
            {err && <small style={{ color: "var(--warn)" }}>{err}</small>}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="ghost" onClick={onClose}>Cancel</button>
            <button className="send" disabled={!name.trim()} onClick={() => onSave({ id: project?.id ?? crypto.randomUUID(), name: name.trim(), instructions, files, createdAt: project?.createdAt ?? Date.now() })}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
