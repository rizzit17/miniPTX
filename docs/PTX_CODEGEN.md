# PTX code generation

## Target and ABI

MiniPTX emits PTX ISA **7.0**, target **sm_75**, with **64-bit addressing**. These are fixed, visible defaults, chosen for a small instruction subset and a Turing-generation target. Automatic target selection is not implemented.

The entry point is:

```ptx
.visible .entry miniptx_kernel(.param .u64 output)
```

`output` must refer to a device buffer holding at least one i32 per source declaration. A caller must launch exactly one thread. The compiler does not compute thread indices or guard concurrent stores. An empty program writes no slots.

The module uses `.reg .b64 %rd<2>` for the supplied pointer and its global-space conversion. It uses `.reg .b32 %r<N>` for arithmetic virtual registers. Registers are virtual PTX registers, not assigned physical hardware registers.

## Instruction selection

| IR | PTX |
| --- | --- |
| `mov` | `mov.s32` |
| `add` | `add.s32` |
| `sub` | `sub.s32` |
| `mul` | `mul.lo.s32` |
| `div` | `div.s32` |
| Declaration result | `st.global.s32 [%rd1+offset], %rN` |

The prologue loads the pointer with `ld.param.u64` and converts it with `cvta.to.global.u64`. Every IR destination receives a new register. Literal operands become immediates; symbolic operands reference previously assigned registers. Declaration stores advance by four bytes.

Identifiers appear only in comments; source names are never interpolated into PTX symbols or directives. Instructions and register names are generated from compiler-controlled values.

Example with folding enabled:

```c
let width = 32;
let height = 16;
let area = width * height;
```

The relevant arithmetic is:

```ptx
mov.s32 %r0, 32;
st.global.s32 [%rd1+0], %r0; // width
mov.s32 %r1, 16;
st.global.s32 [%rd1+4], %r1; // height
mul.lo.s32 %r2, %r0, %r1;
mov.s32 %r3, %r2;
st.global.s32 [%rd1+8], %r3; // area
```

The multiply remains because folding does not propagate identifiers.

## Arithmetic agreement

PTX instructions do not implement MiniPTX's compile-time rejection policy by themselves. The compiler proves every value and intermediate result safe during semantic analysis. For accepted programs, operations fit i32 and divisors are nonzero; the selected instructions therefore represent the intended arithmetic without overflow ambiguity.

`mul.lo.s32` keeps the low 32 bits. Since valid program products fit i32, those bits represent the intended result. Invalid overflow programs never reach code generation. This reasoning depends on the current absence of runtime input and mutation.

If runtime kernel parameters are introduced, compile-time checking alone is insufficient: the language would need defined wrapping/trapping behavior or runtime guards.

## Validation levels

1. **Compiler structural checks:** required version/target/address directives, entry, register declaration, and return. These are intentionally limited checks.
2. **Software instruction checks:** tests interpret emitted arithmetic/register/store instructions and compare values. They do not validate the complete PTX grammar, address-space rules, or device behavior.
3. **NVIDIA PTXAS:** when available, the backend invokes the actual assembler with `-arch=sm_75`, captures diagnostics, and requires a generated cubin plus exit code 0.
4. **GPU execution:** not implemented or claimed.

PTXAS runs in an owned temporary directory with a ten-second wall timeout. On POSIX, its runner additionally applies the documented CPU/memory limits, which are suitable for these tiny modules. Any limit-related failure is reported as failure rather than successful validation.

Manual validation:

```text
ptxas --version
ptxas -arch=sm_75 miniptx.ptx -o miniptx.cubin
```

If the installed toolkit does not support this target/version combination, the service reports the assembler failure. A target change must update module directives, assembler arguments, structural checks, tests, and documentation together.

During this build, PTXAS was not found. No output is claimed to have passed NVIDIA's assembler. Consult [VALIDATION.md](VALIDATION.md) for the actual test record.

Authoritative reference: [NVIDIA Parallel Thread Execution ISA](https://docs.nvidia.com/cuda/parallel-thread-execution/), especially module directives, integer arithmetic, `ld`, `st`, and `cvta`.
