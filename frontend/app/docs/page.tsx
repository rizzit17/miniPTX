import Link from "next/link";
import { ArrowLeft, Cpu } from "lucide-react";
export default function Documentation() {
  return <main className="docs-page"><Link href="/" className="docs-back"><ArrowLeft size={16} /> Back to playground</Link>
    <div className="docs-title"><Cpu size={30} /><span>MiniPTX / Documentation</span></div>
    <h1>A small language.<br />An inspectable compiler.</h1>
    <p>MiniPTX is an educational C++17 compiler for immutable integer declarations. It emits NVIDIA PTX, a virtual instruction set, and exposes each compiler stage. It does not execute programs on a GPU.</p>
    <h2>Language reference</h2><pre>{`program     := declaration* EOF
declaration := "let" IDENT "=" expression ";"
expression  := term (("+" | "-") term)*
term        := primary (("*" | "/") primary)*
primary     := INT | "-" INT | IDENT | "(" expression ")"`}</pre>
    <p>Identifiers use ASCII letters, digits, and underscores, and cannot begin with a digit. Line comments (<code>//</code>) and non-nested block comments (<code>/* … */</code>) are supported. Every value has type signed i32.</p>
    <h2>Arithmetic and declarations</h2><ul><li>Multiplication and division bind more tightly than addition and subtraction. Equal-precedence operations associate left.</li><li>Division truncates toward zero. Division by zero and any intermediate signed overflow are compile errors.</li><li>Integer literals range from −2147483648 through 2147483647. A minus sign before a literal is supported; general unary negation is not.</li><li>Variables are immutable and available only after their declaration. Redeclarations, forward references, and self references are rejected.</li><li>No assignment, loops, functions, floating point, memory access, or runtime inputs are supported. Empty input is a valid empty program.</li></ul>
    <h2>The compilation pipeline</h2><ol><li><strong>Lexer:</strong> creates typed tokens with source spans.</li><li><strong>Parser:</strong> builds an owned expression tree using recursive descent.</li><li><strong>Semantic analysis:</strong> checks names and evaluates all immutable values with checked arithmetic.</li><li><strong>IR generation:</strong> lowers expressions to three-address instructions.</li><li><strong>Optimization:</strong> folds literal-only subexpressions. Identifier values are deliberately not propagated, keeping the instruction pipeline inspectable.</li><li><strong>Code generation:</strong> assigns virtual registers and emits PTX instructions, storing each declaration to an output buffer.</li></ol>
    <h2>Working in the playground</h2><p>Choose a sample, edit the source, then press <kbd>Ctrl / Cmd + Enter</kbd>. Switch constant folding off to compare emitted instructions. Click a token, AST label, optimization, or diagnostic to select its source span. AST branches expand and collapse. Drag panel dividers, or focus a divider and use arrow keys.</p>
    <p>Editor text persists in session storage. Editing after compilation marks the displayed results as stale; recompile to refresh them. PTX can be copied or downloaded after compilation.</p>
    <h2>PTX validation</h2><p>The target is PTX ISA 7.0, <code>sm_75</code>, 64-bit addresses. If PTXAS is installed, the backend invokes it and reports its actual result. Otherwise only structural checks run. Those checks do not prove assembler acceptance.</p><pre>ptxas -arch=sm_75 miniptx.ptx -o miniptx.cubin</pre>
    <p>The kernel ABI takes a device pointer to an array with one signed 32-bit element per declaration, in source order. Any future execution harness must allocate that buffer and launch exactly one thread. No execution harness is included.</p>
    <h2>Local service boundaries</h2><p>Source is limited to 32 KiB and 4096 tokens, and expression depth is bounded. The compiler runs as a controlled subprocess with a three-second timeout. POSIX systems additionally apply CPU, memory, file-size, and descriptor limits. Windows uses wall-clock timeouts. An OS sandbox, rate limiting, and a deployment review are required before exposing the service publicly.</p>
    <p>For build instructions, tests, architecture details, and interview preparation, see the repository README and the <code>docs/</code> directory.</p>
    <a href="https://docs.nvidia.com/cuda/parallel-thread-execution/" target="_blank" rel="noreferrer">NVIDIA PTX ISA reference ↗</a>
  </main>;
}
