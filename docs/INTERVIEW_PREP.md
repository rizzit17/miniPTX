# Interview preparation

## A defensible project description

“I built a C++17 compiler for a small immutable integer language. It lexes and parses source, validates symbols and checked i32 arithmetic, lowers to three-address IR, folds literal constants, and emits PTX. A FastAPI wrapper runs the compiler with bounded inputs and timeouts. A Next.js playground exposes the real intermediate results. GPU execution is outside the project, and PTXAS validation is conditional on toolkit availability.”

Be explicit that this is a restricted educational compiler. It demonstrates compiler engineering concepts; it does not reproduce PTXAS internals.

## Lexer versus parser

The lexer recognizes local patterns such as identifiers, integers, punctuation, and comments, turning characters into typed tokens. It records where each token came from.

The parser recognizes relationships between tokens according to a grammar. For example, the lexer produces `10`, `+`, `20`, `*`, `3`; the parser determines that multiplication belongs below addition in the expression tree.

MiniPTX uses an explicit scanner with source positions rather than splitting source on spaces, so `let x=1+2;` works and diagnostics can point to exact spans.

## Recursive-descent parsing

Each grammar level has a function: `expression`, `term`, and `primary`. The call structure encodes precedence. Loops at the addition and multiplication levels encode left associativity, avoiding left-recursive grammar rules that would recurse forever.

For `8 - 3 - 1`, parsing constructs `(8 - 3) - 1`. Parentheses call back into `expression`. Nesting and resulting AST height are limited to prevent pathological recursion.

## AST versus IR

The AST preserves source structure: declarations, binary expressions, identifiers, and literals. It is convenient for diagnostics and semantic analysis.

The IR exposes evaluation order through simple instructions with explicit operands and destinations. `a + b * 2` becomes a multiply temporary followed by an add. This representation makes instruction selection and transformations easier to inspect.

MiniPTX's IR resembles three-address code but is not a full control-flow SSA representation. There are no blocks, branches, phi nodes, or data-flow analysis.

## Symbol tables

A symbol table answers what a name means in the current scope. MiniPTX has one scope and immutable i32 declarations, so a map stores each declared name and its validated value.

A name is inserted after checking its initializer. This naturally rejects self references and references to later declarations. A duplicate check prevents redeclaration. The source-name namespace is separate from IR temporary names, avoiding collisions such as a user variable named `t0`.

## Constant folding

Constant folding replaces an operation on literal constants with its result, such as `20 * 3` becoming `60`. Folding proceeds from leaves upward so nested expressions can collapse.

The main correctness issue is preserving language semantics. MiniPTX checks every intermediate value in semantic analysis before optimization and uses the same checked arithmetic helper in folding. It cannot fold away a division-by-zero or overflow error.

Constant propagation is different: it substitutes known variable values into uses. MiniPTX intentionally does not implement that pass, although semantic analysis knows all variable values. Keeping it separate makes the scope and visualization clear.

## PTX versus SASS

PTX is NVIDIA's virtual instruction-set representation. It includes typed operations, address spaces, virtual registers, and a target/version contract. It is not the final binary instruction stream executed by the GPU.

SASS refers to architecture-specific GPU machine instructions. Translating PTX to device code involves machine-dependent work that MiniPTX does not attempt.

## PTXAS's role

PTXAS assembles PTX into device machine code, typically packaged in a cubin. It performs architecture-specific code generation and related optimization. MiniPTX emits PTX as input to that downstream tool.

Structural text checks are not a substitute for PTXAS. The project reports whether an actual assembler run passed, failed, or was unavailable. In the recorded local environment, PTXAS was unavailable; do not say it was validated by NVIDIA's toolchain.

## Registers and instruction selection

Each IR destination gets a virtual PTX register. An operation maps to an instruction such as `add.s32`, `mul.lo.s32`, or `div.s32`; variables and temporaries become register operands, while constants become immediate operands.

These are not hardware registers. There is no liveness-based physical allocation, spilling, occupancy model, instruction scheduling, or register-pressure optimization in MiniPTX. PTXAS handles downstream machine constraints.

## Compiler frontend versus backend

The compiler frontend interprets the source language: tokenization, parsing, and semantic checks. IR transformations are often considered a middle end. Code generation from IR to PTX is MiniPTX's compiler backend.

The Python “backend” is a web service, a different use of the same word. It orchestrates compilation but does not implement the language or generate assembly.

## Why checked arithmetic can work without runtime guards

Every value is known because the language has only literals and immutable variables. Semantic analysis evaluates all operations in wider integers, then checks the i32 range and zero divisors. Accepted programs are therefore safe for the chosen PTX instructions.

This design would not automatically work for runtime kernel arguments. That extension requires a deliberate choice among wrapping arithmetic, runtime checks, or other documented semantics.

## Ownership, diagnostics, and untrusted source

The AST uses unique ownership and value containers. Parse failures unwind safely without manual cleanup. Errors contain stage, code, message, and source span.

The web API treats source as untrusted data. It bounds source size, tokens, depth, and subprocess runtime; it does not execute submitted source on the host or GPU. POSIX resource limits add defense in depth. These are not a security sandbox, and public hosting is explicitly outside the safe default setup.

## What the tests establish

Compiler tests verify parsing, semantics, lowering, and optimization. An independent IR interpreter and deterministic generated inputs help catch incorrect transformations. API tests verify the real executable contract and failure paths. Browser tests exercise real compilation, source navigation, examples, persistence, themes, resizing, and exports.

Software interpretation of emitted arithmetic checks register/store behavior. Only PTXAS can establish assembler acceptance for its supported version/target; only an execution harness on suitable hardware can establish device behavior.

## Limitations worth stating directly

- One type and one scope; no functions, loops, branches, floating point, pointers, or runtime inputs.
- No parser error recovery; one diagnostic at a time.
- A small tagged AST, not a general-purpose compiler framework.
- Literal folding only; no propagation, dead-code elimination, scheduling, or hardware register allocation.
- Fixed PTX 7.0 / sm_75 target and single-thread output-buffer ABI.
- No GPU execution or benchmark claims.
- Windows resource isolation is limited to timeout and input bounds.

Good follow-up work is to add PTXAS-backed CI on a CUDA-equipped runner, parser synchronization for multiple diagnostics, and a separately visible constant-propagation pass. Add new language features only with explicit semantics and tests.
