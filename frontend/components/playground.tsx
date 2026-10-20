"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowDownToLine, ArrowRight, BookOpen, Box, Check, ChevronDown, Circle, CircleCheck, Code2, Copy, Cpu, FileCode2, FlaskConical, Github, Layers3, LoaderCircle, Moon, Play, RotateCcw, Sun, Terminal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import Inspectors, { tabs, type InspectorTab } from "@/components/inspectors";
import type { CompileResult, Example, Health, Span } from "@/lib/types";

const CodeEditor = dynamic(() => import("@/components/code-editor"), { ssr: false, loading: () => <div className="editor-loading">Loading editor…</div> });
const initialSource = "// Arithmetic, lowered to PTX instructions\nlet width = 32;\nlet height = 16;\nlet area = width * height;\nlet padded = area + 64;\nlet result = (padded - 32) / 2;\n";
const pipeline = ["Lexical analysis", "Parsing", "Semantic analysis", "IR generation", "Constant folding", "PTX generation"];
const icons = [Code2, Layers3, CircleCheck, Box, FlaskConical, Cpu];
export default function Playground() {
  const [source, setSource] = useState(initialSource);
  const [compiledSource, setCompiledSource] = useState<string | null>(null);
  const [compiledOptimize, setCompiledOptimize] = useState(true);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [selectedExample, setSelectedExample] = useState("arithmetic");
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [optimize, setOptimize] = useState(true);
  const [light, setLight] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("Tokens");
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<{ span: Span; key: number }>();
  const [cursor, setCursor] = useState([1, 1]);
  const [split, setSplit] = useState(50);
  const [bottomHeight, setBottomHeight] = useState(270);
  const [copied, setCopied] = useState(false);
  const workbench = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const stale = result !== null && (compiledSource !== source || compiledOptimize !== optimize);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("miniptx-source");
      if (saved !== null) setSource(saved);
      setLight(localStorage.getItem("miniptx-theme") === "light");
    } catch { /* Storage is optional in privacy-restricted browsers. */ }
    const controller = new AbortController();
    Promise.all([
      fetch("/api/health", { signal: controller.signal }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/api/examples", { signal: controller.signal }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ]).then(([h, e]: [Health, Example[]]) => { setHealth(h); setExamples(e); })
      .catch((error: Error) => { if (error.name !== "AbortError") setNotice("Backend unavailable. Start FastAPI on port 8000, then compile to reconnect."); });
    return () => { controller.abort(); abort.current?.abort(); };
  }, []);
  const updateSource = (value: string) => {
    setSource(value);
    try { sessionStorage.setItem("miniptx-source", value); } catch { /* Optional persistence. */ }
  };
  const compile = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setNotice("");
    const controller = new AbortController(); abort.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, optimize }), signal: controller.signal });
      if (!response.ok) {
        throw new Error(response.status === 413 || response.status === 422 ? "Source is too large or the request is invalid (32 KiB maximum)." :
          response.status === 429 ? "The compiler is busy. Please retry shortly." : `Compilation service returned HTTP ${response.status}.`);
      }
      const data: CompileResult = await response.json();
      setResult(data); setCompiledSource(source); setCompiledOptimize(optimize);
      if (!data.success) setTab("Diagnostics");
      const status = await fetch("/api/health", { signal: controller.signal });
      if (status.ok) {
        setHealth(await status.json());
        if (!examples.length) {
          const samples = await fetch("/api/examples", { signal: controller.signal });
          if (samples.ok) setExamples(await samples.json());
        }
      }
    } catch (error) {
      setNotice(error instanceof Error && error.name !== "AbortError" ? error.message : "The request timed out. Check that the backend is running.");
    } finally { clearTimeout(timer); setBusy(false); running.current = false; }
  }, [source, optimize, examples.length]);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void compile(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [compile]);
  const select = (span: Span) => { if (!stale) setSelection({ span, key: Date.now() }); };
  const chooseExample = (id: string) => {
    const example = examples.find((e) => e.id === id);
    if (example) { updateSource(example.source); setSelectedExample(id); setNotice(""); }
  };
  const copy = async () => {
    if (!result?.ptx) return;
    try { await navigator.clipboard.writeText(result.ptx); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setNotice("Clipboard access was denied. Select and copy the PTX in the output editor."); }
  };
  const download = () => {
    if (!result?.ptx) return;
    const url = URL.createObjectURL(new Blob([result.ptx], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = "miniptx.ptx"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const drag = (event: PointerEvent<HTMLDivElement>, direction: "horizontal" | "vertical") => {
    event.preventDefault();
    const target = event.currentTarget; target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      const rect = workbench.current?.getBoundingClientRect();
      if (!rect) return;
      if (direction === "horizontal") setSplit(Math.max(28, Math.min(72, (e.clientX - rect.left) / rect.width * 100)));
      else setBottomHeight(Math.max(160, Math.min(rect.height - 280, rect.bottom - e.clientY)));
    };
    const stop = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", stop); target.removeEventListener("pointercancel", stop); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", stop); target.addEventListener("pointercancel", stop);
  };
  const separatorKeys = (e: KeyboardEvent<HTMLDivElement>, horizontal: boolean) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      if (horizontal) setSplit((s) => Math.max(28, Math.min(72, s + (e.key === "ArrowLeft" ? -2 : 2))));
      else setBottomHeight((h) => Math.max(160, Math.min(480, h + (e.key === "ArrowUp" ? 20 : -20))));
    }
  };
  const toggleTheme = () => { const next = !light; setLight(next); try { localStorage.setItem("miniptx-theme", next ? "light" : "dark"); } catch { /* Optional persistence. */ } };
  const successful = result?.success && !stale;
  const failedStage = result?.diagnostics[0]?.stage;
  const stageIndex = failedStage === "lexer" ? 0 : failedStage === "parser" ? 1 : failedStage === "semantic" ? 2 : -1;
  return <div className={`app-shell ${light ? "light" : ""}`}>
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-icon"><Cpu size={21} /></span>Mini<span>PTX</span><small>PLAYGROUND</small></Link>
      <nav aria-label="Main navigation"><Link href="/" className="nav-active">Playground</Link><Link href="/docs">Documentation</Link><a href="#example-picker" onClick={() => document.getElementById("example-picker")?.focus()}>Examples</a></nav>
      <div className="topbar-right"><span className={`connection ${health?.compiler ? "connected" : ""}`}><i />{health?.compiler ? "Compiler online" : "Compiler offline"}</span>
        <a href={process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/rizzit17/miniPTX"} target="_blank" rel="noreferrer" className="icon-button" aria-label="GitHub" title="GitHub"><Github size={18} /></a>
        <button className="icon-button" onClick={toggleTheme} aria-label={light ? "Switch to dark theme" : "Switch to light theme"} title="Toggle theme">{light ? <Moon size={18} /> : <Sun size={18} />}</button>
      </div>
    </header>
    <div className="body-layout">
      <aside className="sidebar">
        <div className="section-caption">WORKSPACE</div>
        <div className="sidebar-active"><Terminal size={16} />Compiler playground<span>01</span></div>
        <div className="section-caption pipeline-caption">COMPILATION PIPELINE</div>
        <div className="pipeline">{pipeline.map((stage, i) => { const Icon = icons[i]; const passed = result && !stale && (result.success || failedStage === "assembler" || (stageIndex >= 0 && i < stageIndex)); const failed = result && !stale && !result.success && i === stageIndex; return <div className={`pipeline-step ${passed ? "stage-passed" : ""} ${failed ? "stage-failed" : ""}`} key={stage}><span className="stage-icon"><Icon size={15} /></span><span>{stage}</span>{passed ? <Check size={13} /> : <span className="stage-number">0{i + 1}</span>}</div>; })}</div>
        <div className="target-card"><Cpu size={20} /><strong>Target architecture</strong><div><code>sm_75</code><span>PTX ISA 7.0</span></div><p>Signed 32-bit arithmetic.<br />No GPU required to compile.</p></div>
        <Link href="/docs" className="sidebar-guide"><BookOpen size={16} /><span>Under the hood<small>Explore the compiler design</small></span><ArrowRight size={14} /></Link>
        <div className="sidebar-bottom"><span className="tiny-label">BUILT TO UNDERSTAND</span><p>From a line of code<br />to a lower level.</p><span className="version">MiniPTX v1.0 · Educational compiler</span></div>
      </aside>
      <main className="main-workspace">
        <div className="workspace-intro"><div><div className="eyebrow">THE COMPILER, DEMYSTIFIED</div><h1>Write. Compile. Inspect.</h1><p>Follow your code from its first token to NVIDIA PTX.</p></div><span className="language-badge"><span />C-like language <span className="muted">/</span> i32</span></div>
        <div className="workspace-toolbar">
          <div className="sample-control"><FileCode2 size={16} /><label className="sr-only" htmlFor="example-picker">Example program</label><select id="example-picker" value={selectedExample} onChange={(e) => chooseExample(e.target.value)}><option value="arithmetic" hidden={examples.length > 0}>Arithmetic Expressions</option>{examples.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select><ChevronDown size={13} /></div>
          <button className="icon-button reset-button" title="Reset current example" aria-label="Reset current example" onClick={() => { const sample = examples.find((e) => e.id === selectedExample); updateSource(sample?.source ?? initialSource); }}><RotateCcw size={14} /></button>
          <div className="toolbar-spacer" />
          <label className="optimize-control"><input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} /><span>Constant folding</span><span className="o1-badge">O1</span></label>
          <Button onClick={() => void compile()} disabled={busy} title="Compile (Ctrl/Cmd + Enter)" className="compile-button">{busy ? <LoaderCircle size={15} className="spin" /> : <Play size={14} fill="currentColor" />}{busy ? "Compiling…" : "Compile"}<kbd>⌘ / Ctrl ↵</kbd></Button>
        </div>
        {notice && <div className="notice" role="alert"><TriangleAlert size={16} />{notice}</div>}
        <div className="workbench" ref={workbench} style={{ "--source-width": `${split}%`, "--bottom-height": `${bottomHeight}px` } as CSSProperties}>
          <div className="editors">
            <section className="editor-panel source-panel" aria-label="Source code">
              <div className="panel-header"><span className="file-tab"><FileCode2 size={14} /><strong>program.mptx</strong>{stale && <Circle size={6} fill="currentColor" />}</span><span className="panel-meta">SOURCE</span></div>
              <div className="editor-body"><CodeEditor value={source} language="miniptx" light={light} onChange={updateSource} onCompile={() => void compile()} diagnostics={stale ? [] : result?.diagnostics} selection={selection} onCursor={(line, column) => setCursor([line, column])} /></div>
              <div className="editor-footer"><span>Ln {cursor[0]}, Col {cursor[1]}</span><span>UTF-8 <span className="footer-divider">|</span> MiniPTX</span></div>
            </section>
            <div className="resize-handle horizontal-resize" role="separator" aria-label="Resize source and PTX panels" aria-orientation="vertical" aria-valuenow={Math.round(split)} aria-valuemin={28} aria-valuemax={72} tabIndex={0} onPointerDown={(e) => drag(e, "horizontal")} onKeyDown={(e) => separatorKeys(e, true)} />
            <section className="editor-panel output-panel" aria-label="PTX output">
              <div className="panel-header"><span className="file-tab"><Cpu size={14} /><strong>output.ptx</strong></span><div className="output-actions"><span className="panel-meta">PTX ASSEMBLY</span><button className="icon-button" title="Copy PTX" aria-label="Copy PTX" disabled={!result?.ptx || stale} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button><button className="icon-button" title="Download PTX" aria-label="Download PTX" disabled={!result?.ptx || stale} onClick={download}><ArrowDownToLine size={15} /></button></div></div>
              <div className="editor-body">{result?.ptx ? <CodeEditor value={result.ptx} language="ptx" light={light} readOnly /> : <div className="empty-state ptx-empty"><div className="empty-chip"><Cpu size={27} /></div><strong>{result && !result.success ? "Resolve diagnostics to generate PTX" : "Your code, one level closer to the GPU."}</strong><span>Compile your source to inspect the generated assembly.</span><code>source → tokens → AST → IR → PTX</code></div>}</div>
              <div className="editor-footer"><span className={successful ? "green" : ""}>{successful ? <><CircleCheck size={12} /> Compilation successful</> : stale ? "Source changed · recompile to update" : result ? "Compilation failed" : "Waiting for compilation"}</span><span>{result ? `${result.duration_ms.toFixed(1)} ms` : "sm_75 · PTX 7.0"}</span></div>
            </section>
          </div>
          <div className="resize-handle vertical-resize" role="separator" aria-label="Resize inspector" aria-orientation="horizontal" aria-valuenow={bottomHeight} aria-valuemin={160} aria-valuemax={480} tabIndex={0} onPointerDown={(e) => drag(e, "vertical")} onKeyDown={(e) => separatorKeys(e, false)} />
          <section className="inspector"><div className="inspector-tabs" role="tablist" aria-label="Compiler stages">{tabs.map((name, i) => <button role="tab" id={`tab-${i}`} aria-controls={`panel-${i}`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next]); document.getElementById(`tab-${next}`)?.focus(); } }} onClick={() => setTab(name)} key={name}>{name}{name === "Tokens" && result && <span>{result.tokens.length}</span>}{name === "Diagnostics" && result && <span className={result.diagnostics.length ? "error-count" : ""}>{result.diagnostics.length}</span>}</button>)}<div className="inspector-caption">{stale ? "PREVIOUS COMPILATION" : "INSPECT THE PIPELINE"}</div></div>
            <div className="inspector-content" role="tabpanel" id={`panel-${tabs.indexOf(tab)}`} aria-labelledby={`tab-${tabs.indexOf(tab)}`} tabIndex={0}><Inspectors result={result} tab={tab} select={select} /></div>
          </section>
        </div>
        <footer className="statusbar"><span><span className="status-dot" />{busy ? "Compiling" : "Local compiler pipeline"}<span className="footer-divider">|</span>{result?.assembler.status === "passed" ? "PTXAS validated" : "PTXAS validation " + (result?.assembler.status ?? (health?.ptxas ? "available" : "unavailable"))}</span><span>Educational PTX subset <span className="footer-divider">·</span> No GPU execution</span></footer>
        <div className="sr-only" role="status" aria-live="polite">{copied ? "PTX copied to clipboard." : busy ? "Compiling program." : result ? result.success ? "Compilation successful." : "Compilation failed. See diagnostics." : ""}</div>
      </main>
    </div>
  </div>;
}
