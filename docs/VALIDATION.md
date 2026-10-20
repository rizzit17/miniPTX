# Verification record

Verified locally on **20 October 2026**. These results describe this build, not a benchmark or a claim about untested platforms.

## Environment

- Windows, PowerShell.
- CMake with MinGW GCC 6.3.0, configured with `CMAKE_CXX_STANDARD=17`.
- Python 3.13.7 in the project virtual environment.
- Node.js 22.22.2, Next.js 16.4.2, React 19.3.1, TypeScript 5.9.3.
- Playwright using the installed Google Chrome executable.
- PTXAS not found on PATH or through the available CUDA installation lookup.

## Completed checks

| Check | Actual result |
| --- | --- |
| CMake build | Passed |
| CTest | 1 executable passed; 32 internal cases passed |
| Deterministic arithmetic property checks | 250 programs passed, inside the compiler test suite |
| Python API/code-generation suite | 35 passed, 1 skipped |
| Strict TypeScript check | Passed |
| Next.js production build | Passed |
| Playwright end-to-end suite | 7 passed |
| Frontend → API → C++ smoke test | Passed in production and development modes |
| Desktop/mobile visual inspection | Actual browser captures inspected |
| NVIDIA PTXAS assembly | **Not performed; toolkit unavailable** |
| GPU execution | **Not implemented or performed** |
| Linux/macOS execution | **Not performed locally; CI configuration supplied** |

The Python skip is the conditional PTXAS integration test. The suite emitted one upstream Starlette deprecation warning about its `httpx` TestClient integration; it did not cause a failure. Playwright emitted an environment color-variable warning.

## What the browser tests exercised

1. Editor load and real compilation, tokens, AST, and IR.
2. Example selection, five recorded folds, disabling optimization, and Ctrl+Enter.
3. Structured compiler errors and diagnostic-to-source navigation.
4. Clipboard contents and downloaded PTX contents from the real response.
5. Session persistence, stale-result behavior, and light theme.
6. Token navigation, AST collapse, keyboard resizing, and documentation navigation.
7. Mobile panel stacking and absence of document-wide horizontal overflow.

Screenshots at `screenshots/playground.png` and `screenshots/mobile.png` were captured from those tests. They are actual UI captures, not mockups.

## Issues found and resolved during verification

- A deeply nested AST could exceed the Python response validator's recursion allowance. Parser/AST depth is now bounded at 64, with boundary and rejection regression tests.
- Windows clipboard APIs normalize newlines to CRLF. The clipboard assertion compares equivalent line endings; the downloaded PTX is still checked byte-for-byte.
- The smoke-test status message used a Unicode arrow unsupported by the host console encoding. Its terminal output now uses ASCII.
- Sandbox restrictions prevented npm downloads, Next.js worker creation, and pytest temporary-directory access. Approved local execution completed those checks successfully. These were execution-environment restrictions, not unresolved application failures.

## Boundaries of the evidence

Compiler structural checks verify module elements. Software PTX tests interpret a narrow arithmetic/register/store subset. Neither proves NVIDIA assembler acceptance, GPU compatibility, or device execution.

The PTX target remains PTX 7.0 / sm_75. Validate it with a compatible toolkit using:

```text
ptxas -arch=sm_75 miniptx.ptx -o miniptx.cubin
```

The local launcher was tested in both modes. Preview processes were stopped after verification. See the README for the exact startup and test commands.
