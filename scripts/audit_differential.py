"""Compare source semantics, both IRs and software PTX evaluation; no GPU use."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

from reference_language import ReferenceError, arithmetic, evaluate, generated_programs

SEEDS = (17, 42, 2026, 7500)
VALID_EDGES = [
    "", "/* empty */", "let x=10+20*3;", "let x=(10+20)*3;",
    "let x=24/3/2;", "let x=10-3-2;",
    "let x=-2147483648;", "let x=2147483647;",
    "let x=-2147483648+2147483647;", "let x=2147483647*-1;",
    "let x=-2147483648/1;", "let x=-7/3;let y=7/-3;let z=-7/-3;",
    "let x=0-2147483647-1;", "let x=-0;let y=x*0;",
    "let x=46340*46340;", "let x=1--2;", "let x=1+-2;",
    "let t0=4;let r0=t0*2;let output=r0+1;",
    "let x=1;\r\n\tlet y=/* inline */x+2;// eof",
    "let x=(1+(2*(3+(4/2))));",
]
INVALID_EDGES = [
    ("let x=2147483648;", "INTEGER_OVERFLOW"),
    ("let x=-2147483649;", "INTEGER_OVERFLOW"),
    ("let x=999999999999999999999;", "INTEGER_OVERFLOW"),
    ("let x=2147483647+1;", "ARITHMETIC_OVERFLOW"),
    ("let x=-2147483648-1;", "ARITHMETIC_OVERFLOW"),
    ("let x=46341*46341;", "ARITHMETIC_OVERFLOW"),
    ("let x=-2147483648/-1;", "ARITHMETIC_OVERFLOW"),
    ("let x=1/0;", "DIVISION_BY_ZERO"),
    ("let x=3;let y=1/(x-3);", "DIVISION_BY_ZERO"),
    ("let x=0*(1/0);", "DIVISION_BY_ZERO"),
    ("let x=(2147483647+1)-1;", "ARITHMETIC_OVERFLOW"),
    ("let x=0*(2147483647+1);", "ARITHMETIC_OVERFLOW"),
    ("let x=missing;", "UNDEFINED_VARIABLE"),
    ("let x=x;", "UNDEFINED_VARIABLE"),
    ("let x=y;let y=1;", "UNDEFINED_VARIABLE"),
    ("let x=1;let x=2;", "DUPLICATE_DECLARATION"),
    ("let x=1", "EXPECTED_TOKEN"),
    ("let x=;", "EXPECTED_EXPRESSION"),
    ("let x=(1+2;", "EXPECTED_TOKEN"),
    ("let x=1; x=2;", "EXPECTED_TOKEN"),
    ("let x=1;let y=-x;", "EXPECTED_TOKEN"),
    ("let x=-(1+2);", "EXPECTED_TOKEN"),
    ("let x=1.5;", "INVALID_CHARACTER"),
    ("let x=@;", "INVALID_CHARACTER"),
]


def interpret_ir(instructions):
    registers, result = {}, []
    for instruction in instructions:
        def operand(text):
            return registers[text] if text.startswith(("%", "$")) else int(text)
        value = operand(instruction["left"])
        if instruction["op"] != "mov":
            value = arithmetic({"add": "+", "sub": "-", "mul": "*", "div": "/"}[instruction["op"]],
                               value, operand(instruction["right"]))
        registers[instruction["destination"]] = value
        if instruction["destination"].startswith("$"):
            result.append(value)
    return result


def inspect_ptx(ptx):
    """Strict recognizer/interpreter for emitted lines, not a PTX assembler."""
    match = re.search(r"\.reg \.b32 %r<(\d+)>;", ptx)
    if not match:
        raise AssertionError("Missing arithmetic register declaration")
    count, registers, outputs = int(match[1]), {}, []
    scaffold = {
        ".version 7.0", ".target sm_75", ".address_size 64",
        ".visible .entry miniptx_kernel(", ".param .u64 output", ")", "{", "}",
        ".reg .b64 %rd<2>;", f".reg .b32 %r<{count}>;",
        "ld.param.u64 %rd0, [output];", "cvta.to.global.u64 %rd1, %rd0;", "ret;",
    }

    def operand(text):
        return registers[text] if text.startswith("%") else int(text)

    for raw in ptx.splitlines():
        line = raw.split("//", 1)[0].strip()
        if not line or line in scaffold:
            continue
        instruction = re.fullmatch(r"(mov|add|sub|mul\.lo|div)\.s32 (%r\d+), ([^;]+);", line)
        if instruction:
            op, destination, arguments = instruction.groups()
            assert int(destination[2:]) < count, "Undeclared destination register"
            parts = arguments.split(", ")
            assert len(parts) == (1 if op == "mov" else 2)
            value = operand(parts[0])
            if op != "mov":
                value = arithmetic({"add": "+", "sub": "-", "mul.lo": "*", "div": "/"}[op], value, operand(parts[1]))
            registers[destination] = value
            continue
        store = re.fullmatch(r"st\.global\.s32 \[%rd1\+(\d+)\], (%r\d+);", line)
        if store:
            assert int(store[1]) == len(outputs) * 4, "Nonsequential output slot"
            outputs.append(registers[store[2]])
            continue
        raise AssertionError(f"Unrecognized generated PTX line: {line}")
    return outputs


def run(compiler, corpus=None):
    valid = VALID_EDGES + [source for seed in SEEDS for source in generated_programs(seed)]
    failures, invocations = [], 0
    digest = hashlib.sha256("\0".join(valid + [s for s, _ in INVALID_EDGES]).encode()).hexdigest()
    if corpus:
        corpus.mkdir(parents=True, exist_ok=True)
    for index, (source, expected_code) in enumerate(
        [(source, None) for source in valid] + INVALID_EDGES
    ):
        if expected_code is None:
            expected = evaluate(source)
        else:
            try:
                evaluate(source)
                raise AssertionError("Reference accepted invalid source")
            except ReferenceError as error:
                if expected_code not in ("EXPECTED_TOKEN", "EXPECTED_EXPRESSION"):
                    assert error.code == expected_code
        for optimize in (False, True):
            invocations += 1
            try:
                process = subprocess.run([str(compiler)] + ([] if optimize else ["--no-optimize"]),
                                         input=source, text=True, encoding="utf-8",
                                         capture_output=True, timeout=10)
                assert not process.stderr, process.stderr
                assert process.returncode == (0 if expected_code is None else 1), process.stderr
                result = json.loads(process.stdout)
                if expected_code:
                    assert not result["success"] and not result["ptx"]
                    assert result["diagnostics"][0]["code"] == expected_code
                else:
                    assert result["success"], result["diagnostics"]
                    assert interpret_ir(result["ir"]) == expected
                    assert interpret_ir(result["optimized_ir"]) == expected
                    assert inspect_ptx(result["ptx"]) == expected
                    if corpus:
                        (corpus / f"{index:03d}-O{int(optimize)}.ptx").write_text(result["ptx"], encoding="utf-8")
                if corpus and not optimize:
                    (corpus / f"{index:03d}.mptx").write_text(source, encoding="utf-8")
            except (AssertionError, ValueError, KeyError, subprocess.SubprocessError) as error:
                failures.append({"index": index, "optimize": optimize, "source": source, "error": str(error)})
    return {"seeds": list(SEEDS), "random_valid_programs": 256,
            "handwritten_valid_programs": len(VALID_EDGES), "invalid_programs": len(INVALID_EDGES),
            "compiler_invocations": invocations, "corpus_sha256": digest,
            "failures": failures, "validation": "reference source + IR + software PTX subset; no PTXAS or GPU"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", required=True, type=Path)
    parser.add_argument("--corpus", type=Path)
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args()
    result = run(args.compiler.resolve(), args.corpus)
    text = json.dumps(result, indent=2)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(text + "\n", encoding="utf-8")
    print(text)
    raise SystemExit(bool(result["failures"]))
