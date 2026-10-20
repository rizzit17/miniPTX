"""Audit regressions and failure-path tests. No fake success data in the app."""
import asyncio
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import main, service


@pytest.mark.parametrize("escape", [r"\ud800", r"\udfff"])
def test_unpaired_surrogate_is_rejected(escape):
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.post("/api/compile", content='{"source":"' + escape + '"}',
                               headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "Unicode" in response.json()["detail"]


@pytest.mark.parametrize("stdout", ["null", "[]", '"text"', "42", "{}"])
def test_malformed_compiler_envelope_is_structured(monkeypatch, stdout):
    monkeypatch.setattr(service, "run_process", lambda *a, **kw: SimpleNamespace(returncode=0, stdout=stdout))
    with TestClient(main.app) as client:
        response = client.post("/api/compile", json={"source": "let x=1;"})
    assert response.status_code == 200
    assert response.json()["diagnostics"][0]["code"] == "COMPILER_FAILURE"


def test_exit_code_must_agree_with_success(monkeypatch):
    actual = service.run_process([str(service.COMPILER_PATH)], "let x=1;")
    monkeypatch.setattr(service, "run_process", lambda *a, **kw: SimpleNamespace(returncode=1, stdout=actual.stdout))
    result = service.compile_source(service.CompileRequest(source="let x=1;"))
    assert not result.success
    assert result.diagnostics[0].code == "COMPILER_FAILURE"


def test_concurrent_real_compiles(monkeypatch):
    async def run():
        # Isolate the loop-bound semaphore from TestClient instances.
        monkeypatch.setattr(main, "compile_slots", asyncio.Semaphore(4))
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            responses = await asyncio.gather(*[
                client.post("/api/compile", json={"source": f"let x={i}+2;"}) for i in range(4)
            ])
        assert all(r.status_code == 200 and r.json()["success"] for r in responses)
        assert [r.json()["optimized_ir"][0]["left"] for r in responses] == ["2", "3", "4", "5"]
    asyncio.run(run())


def test_full_capacity_returns_429(monkeypatch):
    async def run():
        slots = asyncio.Semaphore(4)
        monkeypatch.setattr(main, "compile_slots", slots)
        for _ in range(4):
            await slots.acquire()
        try:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/compile", json={"source": ""})
            assert response.status_code == 429
        finally:
            for _ in range(4):
                slots.release()
    asyncio.run(run())


@pytest.mark.parametrize("mode", ["fail", "timeout", "missing-output", "empty-output", "success"])
def test_assembler_failure_paths_and_cleanup(monkeypatch, mode):
    locations = []
    monkeypatch.setattr(service, "assembler_path", lambda: "test-ptxas")
    actual = service.run_process([str(service.COMPILER_PATH)], "let x=1;")
    ptx = json.loads(actual.stdout)["ptx"]

    def assembler(args, **kwargs):
        source, destination = Path(args[2]), Path(args[4])
        locations.append(source.parent)
        assert source.read_text() == ptx
        assert source.parent == destination.parent
        if mode == "timeout":
            raise subprocess.TimeoutExpired(args, 10)
        if mode == "success":
            destination.write_bytes(b"test output")
        elif mode == "empty-output":
            destination.write_bytes(b"")
        return SimpleNamespace(returncode=1 if mode == "fail" else 0, stderr="", stdout="")

    monkeypatch.setattr(service, "run_process", assembler)
    result = service.validate_ptx(ptx)
    assert result.status == ("passed" if mode == "success" else "failed")
    if mode != "success":
        assert "success" not in result.message.lower()
    assert locations and all(not path.exists() for path in locations)


def test_request_cannot_override_executable():
    with TestClient(main.app) as client:
        result = client.post("/api/compile", json={"source": "", "compiler": "cmd.exe"})
    assert result.status_code == 422


def test_subprocess_has_no_shell_interpolation(monkeypatch):
    calls = []
    def record(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=1, stdout="", stderr="")
    monkeypatch.setattr(service.subprocess, "run", record)
    source = "$(touch injected); & whoami; `echo test`"
    service.run_process([str(service.COMPILER_PATH)], source)
    assert calls[0][1]["shell"] is False
    assert calls[0][1]["input"] == source
    assert source not in calls[0][0]
