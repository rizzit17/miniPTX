import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from .models import AssemblerValidation, CompileRequest, CompileResponse, Diagnostic

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BINARY = ROOT / "build" / ("miniptx.exe" if os.name == "nt" else "miniptx")
if not DEFAULT_BINARY.exists() and (ROOT / "build" / "Release" / "miniptx.exe").exists():
    DEFAULT_BINARY = ROOT / "build" / "Release" / "miniptx.exe"
COMPILER_PATH = Path(os.environ.get("MINIPTX_COMPILER", str(DEFAULT_BINARY))).resolve()
TIMEOUT_SECONDS = 3.0


def assembler_path() -> str | None:
    configured = os.environ.get("MINIPTX_PTXAS")
    if configured:
        return shutil.which(configured)
    found = shutil.which("ptxas")
    cuda = os.environ.get("CUDA_PATH")
    if not found and cuda:
        found = shutil.which(str(Path(cuda) / "bin" / "ptxas.exe"))
    return found


def run_process(args: list[str], source: str | None = None, timeout: float = TIMEOUT_SECONDS):
    command = args
    if os.name == "posix":
        command = [sys.executable, "-I", str(Path(__file__).with_name("resource_runner.py")), *args]
    return subprocess.run(
        command,
        input=source,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        shell=False,
        cwd=ROOT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def validate_ptx(ptx: str) -> AssemblerValidation:
    structure = all(part in ptx for part in (
        ".version 7.0\n.target sm_75\n.address_size 64",
        ".visible .entry miniptx_kernel(",
        ".reg .b32 %r<",
        "    ret;\n}\n",
    ))
    if not structure:
        return AssemblerValidation(status="failed", message="Compiler-level structural checks failed.")
    assembler = assembler_path()
    if assembler is None:
        return AssemblerValidation(
            status="unavailable",
            structural_check=True,
            message="PTXAS not found. Structural checks passed; NVIDIA assembler validation was not performed.",
        )
    with tempfile.TemporaryDirectory(prefix="miniptx-") as directory:
        src = Path(directory) / "program.ptx"
        dst = Path(directory) / "program.cubin"
        src.write_text(ptx, encoding="utf-8")
        try:
            result = run_process([assembler, "-arch=sm_75", str(src), "-o", str(dst)], timeout=10)
            passed = result.returncode == 0 and dst.is_file() and dst.stat().st_size > 0
            return AssemblerValidation(
                status="passed" if passed else "failed",
                structural_check=True,
                message=(result.stderr + result.stdout).strip()[:8192] or
                        ("PTXAS assembled successfully." if passed else "PTXAS failed or produced no nonempty cubin."),
            )
        except subprocess.TimeoutExpired:
            return AssemblerValidation(status="failed", structural_check=True, message="PTXAS exceeded 10-second timeout.")
        except OSError as error:
            return AssemblerValidation(status="failed", structural_check=True, message=f"PTXAS could not start: {error.strerror}")


def compile_source(request: CompileRequest) -> CompileResponse:
    start = time.perf_counter()
    skipped = AssemblerValidation(status="skipped", message="No PTX generated.")
    try:
        args = [str(COMPILER_PATH)]
        if not request.optimize:
            args.append("--no-optimize")
        process = run_process(args, request.source)
        if process.returncode not in (0, 1):
            raise RuntimeError("Compiler terminated unexpectedly.")
        data = json.loads(process.stdout)
        if not isinstance(data, dict) or type(data.get("success")) is not bool:
            raise RuntimeError("Compiler returned an invalid response envelope.")
        if data["success"] != (process.returncode == 0):
            raise RuntimeError("Compiler exit code disagrees with its response.")
        response = CompileResponse.model_validate({**data, "assembler": skipped})
        if response.success:
            response.assembler = validate_ptx(response.ptx)
            if response.assembler.status == "failed":
                response.success = False
                response.diagnostics.append(Diagnostic(stage="assembler", code="PTX_VALIDATION_FAILED", message=response.assembler.message))
    except subprocess.TimeoutExpired:
        response = CompileResponse(success=False, assembler=skipped, diagnostics=[
            Diagnostic(stage="service", code="COMPILER_TIMEOUT", message="Compiler exceeded the 3-second time limit.")
        ])
    except FileNotFoundError:
        response = CompileResponse(success=False, assembler=skipped, diagnostics=[
            Diagnostic(stage="service", code="COMPILER_UNAVAILABLE", message="Build the C++ compiler or set MINIPTX_COMPILER.")
        ])
    except (OSError, RuntimeError, ValueError):
        response = CompileResponse(success=False, assembler=skipped, diagnostics=[
            Diagnostic(stage="service", code="COMPILER_FAILURE", message="Compiler process failed or returned invalid output.")
        ])
    response.duration_ms = round((time.perf_counter() - start) * 1000, 2)
    return response
