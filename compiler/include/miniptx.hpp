#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace miniptx {
constexpr std::size_t MAX_SOURCE = 32768;
constexpr std::size_t MAX_TOKENS = 4096;
constexpr unsigned MAX_DEPTH = 64;
struct Span { std::size_t offset = 0, length = 0; unsigned line = 1, column = 1; };
enum class TokenKind { Let, Identifier, Integer, Plus, Minus, Star, Slash, Equal, LParen, RParen, Semicolon, End };
struct Token { TokenKind kind; std::string lexeme; Span span; };
std::string token_name(TokenKind kind);
struct Diagnostic { std::string stage, code, message; Span span; };
class CompileError : public std::runtime_error {
public:
    Diagnostic diagnostic;
    explicit CompileError(Diagnostic d) : std::runtime_error(d.message), diagnostic(std::move(d)) {}
};
[[noreturn]] void fail(const std::string& stage, const std::string& code, const std::string& message, Span span);
enum class ExprKind { Literal, Identifier, Binary };
struct Expr {
    ExprKind kind;
    Span span;
    std::int32_t value = 0;
    unsigned height = 1;
    std::string name;
    TokenKind op = TokenKind::Plus;
    Span operator_span;
    std::unique_ptr<Expr> left, right;
    explicit Expr(ExprKind k, Span s) : kind(k), span(s) {}
};
struct Declaration { std::string name; Span span; std::unique_ptr<Expr> expression; };
using Program = std::vector<Declaration>;
struct Instruction { std::string destination, op, left, right; Span span; };
struct Optimization { std::string before, after; Span span; };
struct Result {
    bool success = false;
    std::vector<Token> tokens;
    Program ast;
    std::vector<Instruction> ir, optimized_ir;
    std::vector<Optimization> optimizations;
    std::vector<Diagnostic> diagnostics;
    std::string ptx;
};
std::vector<Token> lex(const std::string& source);
Program parse(const std::vector<Token>& tokens);
std::map<std::string, std::int32_t> analyze(const Program& program);
std::int32_t checked(TokenKind op, std::int32_t a, std::int32_t b, Span span);
std::vector<Instruction> lower(const Program& program, bool optimize, std::vector<Optimization>& changes);
std::string generate_ptx(const std::vector<Instruction>& ir);
bool structurally_valid(const std::string& ptx);
Result compile(const std::string& source, bool optimize = true);
std::string to_json(const Result& result);
}
