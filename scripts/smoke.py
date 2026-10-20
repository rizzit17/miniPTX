"""Verify frontend-to-backend proxy and the real C++ pipeline without a browser."""
import json
import sys
from urllib.request import Request, urlopen

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
with urlopen(base, timeout=15) as response:
    assert response.status == 200
with urlopen(base + "/api/health", timeout=15) as response:
    assert json.load(response)["compiler"]
request = Request(base + "/api/compile", data=json.dumps({"source": "let result = 10 + 20 * 3;"}).encode(),
                  headers={"Content-Type": "application/json"}, method="POST")
with urlopen(request, timeout=20) as response:
    result = json.load(response)
assert result["success"], result["diagnostics"]
assert result["optimized_ir"][0]["left"] == "70"
assert "mov.s32 %r0, 70;" in result["ptx"]
print(f"PASS: frontend -> API -> C++ compiler; result=70; PTXAS={result['assembler']['status']}")
