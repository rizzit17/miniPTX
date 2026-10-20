#include "miniptx.hpp"
#include <limits>

namespace miniptx {
std::int32_t checked(TokenKind op, std::int32_t a, std::int32_t b, Span span) {
    std::int64_t value;
    switch(op) {
    case TokenKind::Plus: value=std::int64_t(a)+b; break;
    case TokenKind::Minus: value=std::int64_t(a)-b; break;
    case TokenKind::Star: value=std::int64_t(a)*b; break;
    case TokenKind::Slash:
        if(b==0) fail("semantic","DIVISION_BY_ZERO","Division by zero",span);
        value=std::int64_t(a)/b; break;
    default: throw std::logic_error("Invalid arithmetic operator");
    }
    if(value<std::numeric_limits<std::int32_t>::min() || value>std::numeric_limits<std::int32_t>::max())
        fail("semantic","ARITHMETIC_OVERFLOW","Arithmetic overflows signed 32-bit range",span);
    return static_cast<std::int32_t>(value);
}
namespace {
std::int32_t evaluate(const Expr& e, const std::map<std::string,std::int32_t>& symbols, unsigned depth) {
    if(depth>MAX_DEPTH) fail("semantic","DEPTH_LIMIT","AST depth exceeds 64",e.span);
    if(e.kind==ExprKind::Literal) return e.value;
    if(e.kind==ExprKind::Identifier) {
        auto found=symbols.find(e.name);
        if(found==symbols.end()) fail("semantic","UNDEFINED_VARIABLE","Undefined variable '"+e.name+"'",e.span);
        return found->second;
    }
    const auto a=evaluate(*e.left,symbols,depth+1);
    const auto b=evaluate(*e.right,symbols,depth+1);
    return checked(e.op,a,b,e.operator_span);
}
}
std::map<std::string,std::int32_t> analyze(const Program& program) {
    std::map<std::string,std::int32_t> symbols;
    for(const auto& d:program) {
        if(symbols.count(d.name)) fail("semantic","DUPLICATE_DECLARATION","Duplicate declaration '"+d.name+"'",d.span);
        const auto value=evaluate(*d.expression,symbols,0);
        symbols.emplace(d.name,value);
    }
    return symbols;
}
}
