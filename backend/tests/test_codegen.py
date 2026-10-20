"""Interpret the emitted arithmetic subset in software, never on a GPU.

This verifies register use and observable stores, not PTX assembler validity.
"""
import re

import pytest

from backend.app.models import CompileRequest
from backend.app.service import compile_source


def interpret_emitted_arithmetic(ptx):
    registers, output = {}, {}
    instruction = re.compile(r"\s+(mov|add|sub|mul\.lo|div)\.s32 (%r\d+), ([^;]+);")
    store = re.compile(r"\s+st\.global\.s32 \[%rd1\+(\d+)\], (%r\d+);")
    for line in ptx.splitlines():
        match = instruction.match(line)
        if match:
            op, destination, arguments = match.groups()
            values = [registers[a] if a.startswith("%") else int(a) for a in arguments.split(", ")]
            a = values[0]
            b = values[1] if len(values) > 1 else 0
            value = {"mov": lambda: a, "add": lambda: a + b, "sub": lambda: a - b,
                     "mul.lo": lambda: a * b,
                     "div": lambda: (abs(a) // abs(b)) * (-1 if (a < 0) != (b < 0) else 1)}[op]()
            registers[destination] = value
        match = store.match(line)
        if match:
            offset, register = match.groups()
            output[int(offset)] = registers[register]
    return [output[i] for i in sorted(output)]


@pytest.mark.parametrize("optimize", [False, True])
@pytest.mark.parametrize("source,expected", [
    ("let x=10+20*3;", [70]),
    ("let x=32;let y=16;let a=x*y;let b=a+64;let c=(b-32)/2;", [32, 16, 512, 576, 272]),
    ("let low=-2147483648;let high=2147483647;", [-2147483648, 2147483647]),
    ("let x=-7;let y=x/3;let z=y*-2;", [-7, -2, 4]),
    ("let t0=4;let r0=t0*2;let output=r0+1;", [4, 8, 9]),
])
def test_ptx_registers_and_stores_preserve_values(source, expected, optimize):
    result = compile_source(CompileRequest(source=source, optimize=optimize))
    assert result.success
    assert interpret_emitted_arithmetic(result.ptx) == expected
