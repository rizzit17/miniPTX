"use client";
import { Braces, ChevronRight, CircleCheck, Info } from "lucide-react";
import type { CompileResult, Declaration, Expression, Instruction, Span } from "@/lib/types";

export const tabs = ["Tokens", "Abstract Syntax Tree", "Intermediate Representation", "Optimization", "Diagnostics"] as const;
export type InspectorTab = typeof tabs[number];
type TreeNode = Declaration | Expression;
function Tree({ node, select }: { node: TreeNode; select: (s: Span) => void }) {
  const children: TreeNode[] = node.kind === "Declaration" ? [node.expression] : node.kind === "Binary" ? [node.left, node.right] : [];
  const label = node.kind === "Literal" ? String(node.value) : node.kind === "Binary" ? node.operator : node.name;
  return <details className="tree-node" open>
    <summary><ChevronRight size={12} className="tree-chevron" /><span className={`node-kind node-${node.kind.toLowerCase()}`}>{node.kind}</span>
      <button onClick={(e) => { e.preventDefault(); select(node.span); }}>{label}</button><small>{node.span.line}:{node.span.column}</small></summary>
    {children.length > 0 && <div className="tree-children">{children.map((child, i) => <Tree node={child} select={select} key={i} />)}</div>}
  </details>;
}
function IR({ instructions, title }: { instructions: Instruction[]; title: string }) {
  return <div className="ir-column"><div className="ir-heading">{title}<span>{instructions.length} instructions</span></div>
    <ol className="ir-code">{instructions.map((i, index) => <li key={index}><span className="ir-destination">{i.destination}</span> <span className="muted">=</span> <span className="ir-operation">{i.op}</span> {i.left}{i.right && `, ${i.right}`}</li>)}</ol>
  </div>;
}
export default function Inspectors({ result, tab, select }: { result: CompileResult | null; tab: InspectorTab; select: (s: Span) => void }) {
  if (!result) return <div className="empty-state"><Braces size={26} /><strong>A closer look at your compiler</strong><span>Compile a program to explore tokens, trees, and transformations.</span></div>;
  if (tab === "Tokens") return result.tokens.length ? <table className="token-table">
    <thead><tr><th>#</th><th>Token type</th><th>Lexeme</th><th>Line</th><th>Column</th><th>Span</th></tr></thead>
    <tbody>{result.tokens.map((t, i) => <tr key={i}><td>{String(i).padStart(2, "0")}</td><td><span className={`token-kind token-${t.kind}`}>{t.kind}</span></td><td><button className="token-link" onClick={() => select(t.span)} title="Reveal token in source">{t.lexeme || "⟨EOF⟩"}</button></td><td>{t.span.line}</td><td>{t.span.column}</td><td>{t.span.offset}…{t.span.offset + t.span.length}</td></tr>)}</tbody>
  </table> : <div className="empty-state">Lexing did not complete. See Diagnostics.</div>;
  if (tab === "Abstract Syntax Tree") return <div className="tree-panel"><div className="tree-root"><Braces size={15} /> Program <span>{result.ast.length} declarations</span></div>{result.ast.map((d, i) => <Tree node={d} select={select} key={i} />)}{!result.ast.length && <p className="muted">No AST available for this program.</p>}</div>;
  if (tab === "Intermediate Representation") return <div className="ir-comparison"><IR title="ORIGINAL IR" instructions={result.ir} /><IR title="OPTIMIZED IR" instructions={result.optimized_ir} /></div>;
  if (tab === "Optimization") return <div className="optimization-panel">
    <div className="optimization-summary"><span className="green">{result.optimizations.length}</span><div><strong>constant expressions folded</strong><p>Literal expressions evaluated with checked i32 arithmetic.</p></div><span className="optimization-count">{result.ir.length} → {result.optimized_ir.length} IR instructions</span></div>
    {result.optimizations.map((o, i) => <button className="fold-row" onClick={() => select(o.span)} key={i}><span className="fold-number">{i + 1}</span><code>{o.before}</code><span className="muted">→</span><code className="green">{o.after}</code><small>Ln {o.span.line}</small></button>)}
    {!result.optimizations.length && <p className="muted">No literal expressions were folded. Enable optimization or try the Constant Folding example.</p>}
  </div>;
  return <div className="diagnostics-panel">
    {result.diagnostics.length ? result.diagnostics.map((d, i) => <button className="diagnostic" onClick={() => select(d.span)} key={i}><span className="error-tag">ERROR</span><span><strong>{d.message}</strong><small>{d.stage} · {d.code}</small></span><code>Ln {d.span.line}, Col {d.span.column}</code></button>) : <div className="diagnostic-ok"><CircleCheck size={18} /><div><strong>No compiler diagnostics</strong><p>Lexical, syntax, and semantic checks passed.</p></div></div>}
    <div className="assembler-note"><Info size={16} /><div><strong>Assembler validation: {result.assembler.status}</strong><p>{result.assembler.message}</p></div></div>
  </div>;
}
