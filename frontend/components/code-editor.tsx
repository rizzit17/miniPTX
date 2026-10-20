"use client";

import Editor, { loader, type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import type { Diagnostic, Span } from "@/lib/types";

loader.config({ paths: { vs: "/monaco/vs" } });
const setup: BeforeMount = (monaco) => {
  if (!monaco.languages.getLanguages().some((l) => l.id === "miniptx")) {
    monaco.languages.register({ id: "miniptx" });
    monaco.languages.setMonarchTokensProvider("miniptx", {
      tokenizer: { root: [
        [/\/\/.*$/, "comment"], [/\/\*/, "comment", "@comment"],
        [/\blet\b/, "keyword"], [/\b\d+\b/, "number"], [/[a-zA-Z_]\w*/, "identifier"],
        [/[+\-*/=]/, "operator"], [/[();]/, "delimiter"],
      ], comment: [[/[^/*]+/, "comment"], [/\*\//, "comment", "@pop"], [/[/*]/, "comment"]] },
    });
    monaco.languages.register({ id: "ptx" });
    monaco.languages.setMonarchTokensProvider("ptx", {
      tokenizer: { root: [
        [/\/\/.*$/, "comment"], [/\.[a-zA-Z_]\w*/, "keyword"], [/%[\w]+/, "variable"],
        [/\b(?:mov|add|sub|mul|div|ld|st|cvta|ret)\b/, "type"],
        [/\b\d+\b/, "number"], [/[{}()[\];,]/, "delimiter"],
      ] },
    });
  }
  monaco.editor.defineTheme("graphite", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "keyword", foreground: "B59BE0" }, { token: "number", foreground: "DBBC86" },
      { token: "comment", foreground: "6C7D87" }, { token: "identifier", foreground: "D3DEE6" },
      { token: "variable", foreground: "88B9D6" }, { token: "type", foreground: "A7CD75" },
    ],
    colors: {
      "editor.background": "#11151B", "editor.foreground": "#E8EDF2",
      "editorLineNumber.foreground": "#4E5A69", "editorLineNumber.activeForeground": "#A5B3C2",
      "editor.lineHighlightBackground": "#181E27", "editor.selectionBackground": "#314632",
      "editorCursor.foreground": "#A0D05A", "editorWidget.background": "#181D25",
    },
  });
};
interface Props {
  value: string; language: "miniptx" | "ptx"; light: boolean; readOnly?: boolean;
  onChange?: (value: string) => void; onCompile?: () => void;
  diagnostics?: Diagnostic[]; selection?: { span: Span; key: number };
  onCursor?: (line: number, column: number) => void;
}
export default function CodeEditor({ value, language, light, readOnly, onChange, onCompile, diagnostics = [], selection, onCursor }: Props) {
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const api = useRef<Parameters<OnMount>[1] | null>(null);
  const compile = useRef(onCompile);
  compile.current = onCompile;
  const applyMarkers = () => {
    const model = instance.current?.getModel();
    if (!model || !api.current) return;
    api.current.editor.setModelMarkers(model, "miniptx", diagnostics.map((d) => {
      const start = model.getPositionAt(d.span.offset);
      const end = model.getPositionAt(d.span.offset + Math.max(1, d.span.length));
      return { message: d.message, severity: api.current!.MarkerSeverity.Error,
        startLineNumber: start.lineNumber, startColumn: start.column,
        endLineNumber: end.lineNumber, endColumn: Math.max(start.lineNumber === end.lineNumber ? start.column + 1 : 1, end.column) };
    }));
  };
  useEffect(applyMarkers, [diagnostics]);
  useEffect(() => {
    const model = instance.current?.getModel();
    if (!selection || !model || !instance.current) return;
    const start = model.getPositionAt(selection.span.offset);
    const end = model.getPositionAt(selection.span.offset + selection.span.length);
    instance.current.setSelection({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
    instance.current.revealPositionInCenter(start);
    instance.current.focus();
  }, [selection]);
  const mount: OnMount = (ed, monaco) => {
    instance.current = ed; api.current = monaco; applyMarkers();
    if (!readOnly) ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => compile.current?.());
    ed.onDidChangeCursorPosition((e) => onCursor?.(e.position.lineNumber, e.position.column));
  };
  return <Editor height="100%" value={value} language={language} theme={light ? "vs" : "graphite"}
    beforeMount={setup} onMount={mount} onChange={(v) => onChange?.(v ?? "")}
    loading={<div className="editor-loading">Loading editor…</div>}
    options={{ readOnly, ariaLabel: readOnly ? "Generated PTX assembly" : "MiniPTX source editor", automaticLayout: true,
      fontSize: 13, lineHeight: 24, fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
      minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 20, bottom: 20 },
      lineNumbersMinChars: 3, renderLineHighlight: readOnly ? "none" : "all", overviewRulerLanes: 0,
      folding: true, wordWrap: "on", tabSize: 2, contextmenu: true, fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 } }} />;
}
