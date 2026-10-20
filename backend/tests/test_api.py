import json
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app import service


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def test_health(client):
    assert client.get("/api/health").json()["compiler"] is True


def test_real_compilation(client):
    result = client.post("/api/compile", json={"source": "let x = 10 + 20 * 3;"}).json()
    assert result["success"] is True
    assert result["tokens"][0]["kind"] == "Let"
    assert result["ast"][0]["expression"]["operator"] == "Plus"
    assert result["optimized_ir"][0]["left"] == "70"
    assert "mov.s32 %r0, 70;" in result["ptx"]
    assert result["assembler"]["status"] in ("unavailable", "passed")
    assert result["assembler"]["structural_check"] is True
    assert result["duration_ms"] >= 0


@pytest.mark.parametrize("source,code", [
    ("let x = missing;", "UNDEFINED_VARIABLE"),
    ("let x = 1 / 0;", "DIVISION_BY_ZERO"),
    ("let x = 2147483647 + 1;", "ARITHMETIC_OVERFLOW"),
    ("let x = 1; let x = 2;", "DUPLICATE_DECLARATION"),
    ("let x = 1", "EXPECTED_TOKEN"),
    ("let x = @;", "INVALID_CHARACTER"),
])
def test_structured_errors(client, source, code):
    result = client.post("/api/compile", json={"source": source}).json()
    assert result["success"] is False
    assert result["ptx"] == ""
    assert result["diagnostics"][0]["code"] == code
    assert result["diagnostics"][0]["span"]["line"] == 1
    assert result["assembler"]["status"] == "skipped"


def test_error_location(client):
    result = client.post("/api/compile", json={"source": "let a = 1;\nlet b = missing;"}).json()
    assert result["diagnostics"][0]["span"] == {"offset": 19, "length": 7, "line": 2, "column": 9}


@pytest.mark.parametrize("body", [{}, {"source": 2}, {"source": "let x=1;", "extra": "bad"}, {"source": "x" * 32769}])
def test_invalid_input(client, body):
    assert client.post("/api/compile", json=body).status_code == 422


def test_byte_limit(client):
    assert client.post("/api/compile", json={"source": "é" * 20000}).status_code == 413


def test_raw_body_limit(client):
    assert client.post("/api/compile", content=b" " * 262145).status_code == 413


def test_malformed_json(client):
    assert client.post("/api/compile", content="{", headers={"Content-Type": "application/json"}).status_code == 422


def test_timeout(client, monkeypatch):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("miniptx", 3)
    monkeypatch.setattr(service, "run_process", timeout)
    result = client.post("/api/compile", json={"source": "let x=1;"}).json()
    assert result["success"] is False
    assert result["diagnostics"][0]["code"] == "COMPILER_TIMEOUT"


def test_process_timeout_is_enforced():
    import sys
    with pytest.raises(subprocess.TimeoutExpired):
        service.run_process([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.1)


def test_bad_compiler_output(client, monkeypatch):
    monkeypatch.setattr(service, "run_process", lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout="not json"))
    assert client.post("/api/compile", json={"source": ""}).json()["diagnostics"][0]["code"] == "COMPILER_FAILURE"


def test_missing_compiler(client, monkeypatch, tmp_path):
    monkeypatch.setattr(service, "COMPILER_PATH", tmp_path / "absent")
    assert client.post("/api/compile", json={"source": ""}).json()["diagnostics"][0]["code"] == "COMPILER_UNAVAILABLE"


def test_optimization_switch(client):
    data = client.post("/api/compile", json={"source": "let x=2+3*4;", "optimize": False}).json()
    assert data["success"] is True
    assert data["optimizations"] == []
    assert "mul.lo.s32" in data["ptx"]


def test_every_example(client):
    examples = client.get("/api/examples").json()
    assert len(examples) >= 6
    for example in examples:
        result = client.post("/api/compile", json={"source": example["source"]}).json()
        assert result["success"] is not example["expected_error"], example["name"]


def test_large_but_valid_ast(client):
    source = "let x=" + "+".join(["1"] * 64) + ";"
    result = client.post("/api/compile", json={"source": source}).json()
    assert result["success"] is True
    assert result["optimized_ir"][0]["left"] == "64"


def test_ast_depth_limit_is_a_compiler_diagnostic(client):
    result = client.post("/api/compile", json={"source": "let x=" + "+".join(["1"] * 100) + ";"}).json()
    assert result["success"] is False
    assert result["diagnostics"][0]["code"] == "DEPTH_LIMIT"


def test_assembler_unavailable(monkeypatch):
    monkeypatch.setattr(service, "assembler_path", lambda: None)
    response = service.compile_source(service.CompileRequest(source="let x=1;"))
    assert response.success
    assert response.assembler.status == "unavailable"


def test_ptxas_if_available():
    if service.assembler_path() is None:
        pytest.skip("NVIDIA PTXAS not installed")
    for optimize in (False, True):
        for example in json.loads((service.ROOT / "examples" / "manifest.json").read_text()):
            if not example["expected_error"]:
                result = service.compile_source(service.CompileRequest(source=example["source"], optimize=optimize))
                assert result.assembler.status == "passed", result.assembler.message
