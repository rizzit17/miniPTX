# Architecture

## Boundaries

The browser owns editor state and presentation. It sends source to the same-origin `/api/compile` route, which Next.js forwards to FastAPI. The frontend never performs compilation or supplies precomputed output.

FastAPI validates the request, acquires one of four compilation slots, and runs the C++ CLI in a worker thread. Compiler arguments are an explicit array; source is passed through stdin. There is no shell interpolation or source-generated host code. The CLI writes JSON and exits. Pydantic validates the returned tree and other fields before the API returns them.

On POSIX, a separate Python process applies resource limits and replaces itself with the compiler using `execv`. This avoids the thread-safety risks of `preexec_fn` in a multithreaded server. On Windows, the service enforces a subprocess wall timeout and source bounds. The optional assembler uses fixed filenames inside an owned temporary directory and is subject to the same runner limits on POSIX.

## Compiler organization

| Module | Input | Output |
| --- | --- | --- |
| `lexer.cpp` | ASCII source | Typed tokens with source spans |
| `parser.cpp` | Tokens | Declarations and expression trees |
| `semantic.cpp` | AST | Validated symbol values or diagnostic |
| `ir.cpp` | Valid AST, optimization flag | Three-address instructions and fold records |
| `codegen.cpp` | Selected IR | PTX text |
| `compiler.cpp` | Source, flag | Pipeline result and JSON serialization |
| `main.cpp` | Bounded stdin | JSON stdout, stderr on internal failure |

Expression kinds and token kinds are enums. Binary children and declaration initializers are exclusively owned through `std::unique_ptr`. The parser moves ownership into the tree. Tokens, IR instructions, and diagnostics are value types. No manual `new`/`delete` or shared ownership is needed.

The tagged AST struct is intentionally small: each kind uses its relevant fields, and the parser controls construction. It is not a fully invariant-enforcing algebraic data type; a `std::variant` representation would be a reasonable extension with a newer uniform toolchain.

## Data contract

Compiler spans use zero-based byte offset/length and one-based line/column. Source is restricted to ASCII, including comments, so those offsets can be mapped directly to Monaco's UTF-16 positions. Whitespace and comments are discarded as tokens but still advance source locations. CRLF advances the line once; tabs count as one source column.

All successful stages are retained. Lexing failure has no complete token stream. Parsing failure retains tokens but no partial AST. Semantic failure retains the complete AST, but produces no IR/PTX. Error recovery is intentionally not implemented.

The backend adds wall-clock duration and assembler validation metadata. `success` is false if compilation fails or an available assembler rejects its output. When PTXAS is unavailable, successful C++ compilation still reports `success: true`, alongside `assembler.status: unavailable`.

## Frontend state

The source, optimization setting, compile result, and source/settings associated with that result are separate state. Editing after compilation marks the old result as stale and disables source navigation and exports until recompilation. A local in-flight guard prevents duplicate shortcut/button submissions.

Monaco is dynamically loaded in the browser and served from `public/monaco/`; the npm lifecycle scripts copy its distribution there. The source and PTX have separate language definitions. Diagnostics become Monaco markers, while token/tree/fold clicks select source spans.

Editor contents use session storage and theme preference uses local storage. Storage and clipboard failures do not block compilation. The five inspector tabs have keyboard navigation; panel separators support pointer dragging and arrow keys. Mobile stacks the editors and allows horizontal scrolling within the tab strip.

## Operational boundaries

Limits are defensive measures, not public-service isolation. Concurrency is per backend process. There is no distributed queue, account system, or public deployment setup. The local launcher binds loopback and refuses occupied ports.

The API shields its compiler worker from request cancellation and releases its semaphore slot when the worker finishes, preserving the concurrency limit even if a client disconnects.

Compiler output is bounded indirectly by source/token/depth limits; subprocess stdout is captured in memory. The executable path and optional PTXAS path are trusted operator configuration. Do not allow API clients to override them.

## Deliberate choices

- No AST graph library: a hierarchical tree makes the small language readable and keyboard accessible.
- No animation dependency: brief CSS transitions suffice for this tool.
- No external fonts/CDNs: the installed application can run without network access.
- No database/authentication: the requested workflow is local and session-based.
- No GPU launch: assembly generation and validation are separate from device execution.
