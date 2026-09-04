"use client";

/**
 * Code interpreter — runs Python (Pyodide via CDN, with numpy/pandas/matplotlib auto-loaded)
 * or JavaScript inside a sandboxed iframe. Nothing leaves the browser. stdout, errors and
 * matplotlib figures are posted back to the parent.
 */
import { useEffect, useRef, useState } from "react";

export interface RunResult { stdout: string; error?: string; images: string[]; ms: number }

const RUNNER = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"></script></head><body>
<script>
let py;
async function getPy(){
  if(!py){ py = await loadPyodide({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"}); }
  return py;
}
async function runPython(code){
  const out=[]; const p=await getPy();
  p.setStdout({batched:(s)=>out.push(s)}); p.setStderr({batched:(s)=>out.push(s)});
  await p.loadPackagesFromImports(code).catch(()=>{});
  const needsMpl=/matplotlib/.test(code);
  if(needsMpl){ await p.loadPackage("matplotlib"); await p.runPythonAsync("import matplotlib\\nmatplotlib.use('AGG')"); }
  let error; let result;
  try{ result = await p.runPythonAsync(code); }catch(e){ error=String(e); }
  const images=[];
  if(needsMpl){
    try{ const b=await p.runPythonAsync("import matplotlib.pyplot as plt, io, base64\\n_imgs=[]\\nfor n in plt.get_fignums():\\n    buf=io.BytesIO(); plt.figure(n).savefig(buf,format='png',bbox_inches='tight'); _imgs.append('data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode())\\nplt.close('all')\\n_imgs"); images.push(...b.toJs()); }catch(e){}
  }
  if(result!==undefined && result!==null && String(result)!=="" ) out.push(String(result));
  return {stdout:out.join("\\n"),error,images};
}
function runJs(code){
  const out=[]; const log=(...a)=>out.push(a.map(x=>typeof x==="object"?JSON.stringify(x,null,1):String(x)).join(" "));
  const c={log,info:log,warn:log,error:log,table:(x)=>log(x)};
  let error;
  try{ const r=new Function("console",'"use strict";'+code)(c); if(r!==undefined) out.push(String(r)); }catch(e){ error=String(e&&e.stack||e); }
  return Promise.resolve({stdout:out.join("\\n"),error,images:[]});
}
window.addEventListener("message", async (ev)=>{
  const {id,lang,code}=ev.data||{}; if(!id) return;
  const t=performance.now();
  try{ const r = lang==="python" ? await runPython(code) : await runJs(code); parent.postMessage({id,...r,ms:Math.round(performance.now()-t)},"*"); }
  catch(e){ parent.postMessage({id,stdout:"",error:String(e),images:[],ms:Math.round(performance.now()-t)},"*"); }
});
parent.postMessage({ready:true},"*");
</script></body></html>`;

export function useInterpreter() {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef(new Map<string, (r: RunResult) => void>());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const f = document.createElement("iframe");
    f.style.display = "none"; f.setAttribute("sandbox", "allow-scripts"); f.srcdoc = RUNNER;
    document.body.appendChild(f); frame.current = f;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow) return;
      if (e.data?.ready) { setReady(true); return; }
      const cb = pending.current.get(e.data?.id); if (cb) { pending.current.delete(e.data.id); cb(e.data as RunResult); }
    };
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("message", onMsg); f.remove(); };
  }, []);
  const run = (lang: "python" | "javascript", code: string, timeoutMs = 120_000) => new Promise<RunResult>((resolve) => {
    const id = crypto.randomUUID();
    const t = setTimeout(() => { pending.current.delete(id); resolve({ stdout: "", error: `Timed out after ${timeoutMs / 1000}s`, images: [], ms: timeoutMs }); }, timeoutMs);
    pending.current.set(id, (r) => { clearTimeout(t); resolve(r); });
    frame.current?.contentWindow?.postMessage({ id, lang, code }, "*");
  });
  return { ready, run };
}

export function runnableLang(lang: string): "python" | "javascript" | null {
  const l = lang.toLowerCase();
  if (l === "python" || l === "py") return "python";
  if (l === "javascript" || l === "js" || l === "node") return "javascript";
  return null;
}

export function RunOutput({ r, lang }: { r: RunResult | "running"; lang: string }) {
  if (r === "running") return <div className="run-out"><span className="spin" /> running {lang}… <span className="hint" style={{ margin: 0 }}>(first Python run downloads the runtime, ~10 MB)</span></div>;
  return (
    <div className={`run-out ${r.error ? "bad" : ""}`}>
      <div className="run-head"><span className="tag">{lang}</span><span>{r.error ? "error" : "ok"} · {r.ms} ms</span></div>
      {r.stdout && <pre>{r.stdout.slice(0, 20_000)}</pre>}
      {r.error && <pre className="run-err">{r.error.slice(0, 4000)}</pre>}
      {r.images.map((src, i) => <img key={i} src={src} alt="figure" />)}
    </div>
  );
}
