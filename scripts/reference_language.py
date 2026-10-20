"""Independent source evaluator used only by audit tests.

Uses a regex scanner and iterative shunting-yard evaluation, not the compiler's
recursive-descent AST, IR, or code generator. Python integers provide exact
arithmetic; every intermediate result is explicitly checked against i32.
"""
import random
import re

MIN_I32, MAX_I32 = -(2**31), 2**31 - 1
TOKEN = re.compile(r"\s+|//[^\n]*|/\*[\s\S]*?\*/|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[=;()+*/-]")
PRECEDENCE = {"+": 1, "-": 1, "*": 2, "/": 2}


class ReferenceError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def i32(value, code="ARITHMETIC_OVERFLOW"):
    if not MIN_I32 <= value <= MAX_I32:
        raise ReferenceError(code)
    return value


def arithmetic(operator, a, b):
    if operator == "+":
        value = a + b
    elif operator == "-":
        value = a - b
    elif operator == "*":
        value = a * b
    elif operator == "/":
        if b == 0:
            raise ReferenceError("DIVISION_BY_ZERO")
        value = abs(a) // abs(b)
        if (a < 0) != (b < 0):
            value = -value
    else:
        raise ReferenceError("SYNTAX")
    return i32(value)


def scan(source):
    if not source.isascii() or "\0" in source:
        raise ReferenceError("INVALID_CHARACTER")
    tokens, position = [], 0
    while position < len(source):
        match = TOKEN.match(source, position)
        if not match:
            raise ReferenceError("INVALID_CHARACTER")
        text = match.group()
        if not (text.isspace() or text.startswith("//") or text.startswith("/*")):
            tokens.append(text)
        position = match.end()
    return tokens


def evaluate_expression(tokens, symbols):
    values, operators = [], []
    expect_operand, index = True, 0

    def reduce():
        if len(values) < 2 or not operators or operators[-1] == "(":
            raise ReferenceError("SYNTAX")
        b, a = values.pop(), values.pop()
        values.append(arithmetic(operators.pop(), a, b))

    while index < len(tokens):
        token = tokens[index]
        if expect_operand:
            if token == "(":
                operators.append(token)
            else:
                negative = token == "-"
                if negative:
                    index += 1
                    if index == len(tokens) or not tokens[index].isdigit():
                        raise ReferenceError("SYNTAX")
                    token = tokens[index]
                if token.isdigit():
                    values.append(i32(int(token) * (-1 if negative else 1), "INTEGER_OVERFLOW"))
                elif re.fullmatch(r"[A-Za-z_]\w*", token) and token != "let":
                    if token not in symbols:
                        raise ReferenceError("UNDEFINED_VARIABLE")
                    values.append(symbols[token])
                else:
                    raise ReferenceError("SYNTAX")
                expect_operand = False
        elif token == ")":
            while operators and operators[-1] != "(":
                reduce()
            if not operators:
                raise ReferenceError("SYNTAX")
            operators.pop()
        elif token in PRECEDENCE:
            while operators and operators[-1] != "(" and PRECEDENCE[operators[-1]] >= PRECEDENCE[token]:
                reduce()
            operators.append(token)
            expect_operand = True
        else:
            raise ReferenceError("SYNTAX")
        index += 1
    if expect_operand:
        raise ReferenceError("SYNTAX")
    while operators:
        reduce()
    if len(values) != 1:
        raise ReferenceError("SYNTAX")
    return values[0]


def evaluate(source):
    tokens = scan(source)
    symbols, outputs, index = {}, [], 0
    while index < len(tokens):
        if index + 3 >= len(tokens) or tokens[index] != "let" or tokens[index + 2] != "=":
            raise ReferenceError("SYNTAX")
        name = tokens[index + 1]
        if name == "let" or not re.fullmatch(r"[A-Za-z_]\w*", name):
            raise ReferenceError("SYNTAX")
        if name in symbols:
            raise ReferenceError("DUPLICATE_DECLARATION")
        end = index + 3
        while end < len(tokens) and tokens[end] != ";":
            end += 1
        if end == len(tokens):
            raise ReferenceError("SYNTAX")
        value = evaluate_expression(tokens[index + 3:end], symbols)
        symbols[name] = value
        outputs.append(value)
        index = end + 1
    return outputs


def generated_programs(seed, count=64):
    randomizer = random.Random(seed)

    def expression(names, depth):
        if depth == 0 or randomizer.random() < 0.35:
            return randomizer.choice(names) if names and randomizer.random() < 0.35 else str(randomizer.randint(-40, 40))
        left, right = expression(names, depth - 1), expression(names, depth - 1)
        text = f"{left} {randomizer.choice(list(PRECEDENCE))} {right}"
        return f"({text})" if randomizer.random() < 0.7 else text

    result, attempts = [], 0
    while len(result) < count:
        attempts += 1
        if attempts > count * 100:
            raise RuntimeError("Could not generate enough valid programs")
        names, lines = [], [f"// deterministic seed {seed}, candidate {attempts}"]
        for declaration in range(randomizer.randint(1, 6)):
            name = f"value{declaration}"
            lines.append(f"let {name} = {expression(names, 4)};")
            names.append(name)
        source = "\n".join(lines) + "\n"
        try:
            evaluate(source)
        except ReferenceError:
            continue
        result.append(source)
    return result
