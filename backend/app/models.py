from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class CompileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(max_length=32768)
    optimize: bool = True


class Span(BaseModel):
    offset: int = 0
    length: int = 0
    line: int = 1
    column: int = 1


class Token(BaseModel):
    kind: str
    lexeme: str
    span: Span


class LiteralNode(BaseModel):
    kind: Literal["Literal"]
    value: int
    span: Span


class IdentifierNode(BaseModel):
    kind: Literal["Identifier"]
    name: str
    span: Span


class BinaryNode(BaseModel):
    kind: Literal["Binary"]
    operator: str
    left: "Expression"
    right: "Expression"
    span: Span


Expression = Annotated[Union[LiteralNode, IdentifierNode, BinaryNode], Field(discriminator="kind")]
BinaryNode.model_rebuild()


class Declaration(BaseModel):
    kind: Literal["Declaration"]
    name: str
    expression: Expression
    span: Span


class Instruction(BaseModel):
    destination: str
    op: Literal["mov", "add", "sub", "mul", "div"]
    left: str
    right: str
    span: Span


class Optimization(BaseModel):
    before: str
    after: str
    span: Span


class Diagnostic(BaseModel):
    severity: Literal["error", "warning"] = "error"
    stage: str
    code: str
    message: str
    span: Span = Field(default_factory=Span)


class AssemblerValidation(BaseModel):
    status: Literal["passed", "failed", "unavailable", "skipped"]
    message: str
    structural_check: bool = False


class CompileResponse(BaseModel):
    success: bool
    tokens: list[Token] = Field(default_factory=list)
    ast: list[Declaration] = Field(default_factory=list)
    ir: list[Instruction] = Field(default_factory=list)
    optimized_ir: list[Instruction] = Field(default_factory=list)
    optimizations: list[Optimization] = Field(default_factory=list)
    ptx: str = ""
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    duration_ms: float = 0
    assembler: AssemblerValidation
