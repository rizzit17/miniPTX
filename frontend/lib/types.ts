export interface Span { offset: number; length: number; line: number; column: number }
export interface Token { kind: string; lexeme: string; span: Span }
export type Expression =
  | { kind: "Literal"; value: number; span: Span }
  | { kind: "Identifier"; name: string; span: Span }
  | { kind: "Binary"; operator: string; left: Expression; right: Expression; span: Span };
export interface Declaration { kind: "Declaration"; name: string; expression: Expression; span: Span }
export interface Instruction { destination: string; op: string; left: string; right: string; span: Span }
export interface Diagnostic { severity: "error" | "warning"; stage: string; code: string; message: string; span: Span }
export interface CompileResult {
  success: boolean;
  tokens: Token[];
  ast: Declaration[];
  ir: Instruction[];
  optimized_ir: Instruction[];
  optimizations: { before: string; after: string; span: Span }[];
  ptx: string;
  diagnostics: Diagnostic[];
  duration_ms: number;
  assembler: { status: "passed" | "failed" | "unavailable" | "skipped"; message: string; structural_check: boolean };
}
export interface Example { id: string; name: string; description: string; source: string; expected_error: boolean }
export interface Health { status: string; compiler: boolean; ptxas: boolean; target: string; ptx_version: string }
