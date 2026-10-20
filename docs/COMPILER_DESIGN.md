# Compiler design

## Grammar and parsing

```ebnf
program     = { declaration }, EOF ;
declaration = "let", identifier, "=", expression, ";" ;
expression  = term, { ("+" | "-"), term } ;
term        = primary, { ("*" | "/"), primary } ;
primary     = integer | "-", integer | identifier | "(", expression, ")" ;
```

`primary` consumes literals, names, or grouped expressions. `term` repeatedly consumes multiplication/division; `expression` repeatedly consumes addition/subtraction. The loops build left-associated trees. Calling `term` from `expression` gives multiplication/division higher precedence without a separate precedence table.

For `10 + 20 * 3`, the root is `Binary(Plus)`, its left child is `Literal(10)`, and its right child is `Binary(Star, 20, 3)`.

Unary minus is restricted to integer literals. `-2147483648` is accepted by parsing the magnitude in int64 and checking the signed range before converting. `-x` and `-(1 + 2)` are rejected. `0 - x` is supported.

Limits apply both to parser nesting and AST height. Checking height while constructing binary nodes prevents long left-associated expressions from bypassing the recursive-nesting limit. The limit of 64 also bounds serialization across the C++/Pydantic boundary.

## Symbol table and evaluation

The symbol table maps identifiers to i32 values. Declarations are analyzed in source order. A name is inserted only after its initializer has been checked; consequently self references and forward references are undefined.

All values are integers, so basic type validation is enforced by the grammar and the absence of other literal/expression kinds. There are no implicit conversions. A future multi-type language would need explicit type inference/checking.

The language has no runtime inputs, mutation, or control flow. Every value can therefore be evaluated during semantic analysis. This does **not** mean the optimizer replaces every variable: analysis proves safety, while optimization is an independent transformation.

Arithmetic is computed in int64, then checked against the i32 range. The product of any two i32 values fits int64. Addition/subtraction also fit. Division checks for zero and uses int64 division before the range check, so `INT_MIN / -1` cannot trigger signed overflow in host C++.

Errors apply to each intermediate operation, not just the final value. `(2147483647 + 1) - 1` is invalid even though the final mathematical result would fit i32. Division truncates toward zero. No wrapping or saturation is part of the language.

## Lowering

Lowering recursively visits operands before the operator. It gives intermediate results names `%t0`, `%t1`, and so forth; declaration values use `$name`. These namespaces cannot collide with source identifiers.

```text
let x = 10;
let y = x * (2 + 3);

$x = mov 10
%t0 = add 2, 3
%t1 = mul $x, %t0
$y = mov %t1
```

Original and optimized IR are lowered independently from the unchanged AST. This preserves the original tree for inspection.

## Constant folding

Each lowering call returns an operand tagged as constant or symbolic. If both operands are constant and optimization is enabled, the same checked arithmetic helper computes the result. The pass records a before/after pair and source span, then returns a constant operand instead of emitting the binary instruction.

For the previous program:

```text
$x = mov 10
%t0 = mul $x, 5
$y = mov %t0
```

The pass does not propagate symbol values, reassociate operators, reorder expressions, perform common-subexpression elimination, or eliminate declarations. This is a narrow, explainable optimization. Each declaration is observable through its output-buffer slot.

Turning optimization off changes emitted instructions, not diagnostics or language semantics. Semantic analysis always runs first.

## Diagnostics and ownership

Compiler errors carry stage, stable code, message, and span. Expected user errors use `CompileError`; unexpected internal exceptions go to stderr with exit code 2. The backend turns unexpected process/output failures into service diagnostics without presenting them as language errors.

The compiler stops at the first error. Parser ownership is exception-safe through unique pointers and vectors. Failed parses release partial trees automatically.

## Tests

Tests cover source positions/comments, syntax/precedence/associativity, name resolution, arithmetic boundaries, depth/token/source bounds, folding toggles, and emitted instructions. A separate IR interpreter checks 250 deterministic generated arithmetic programs against directly calculated expected values.

API tests cover the serialization boundary, malformed input, real subprocess timeouts, structured diagnostics, examples, and optional assembly. A small software interpreter checks the arithmetic/register/store subset of generated PTX. It does not replace NVIDIA assembler validation or GPU tests.
