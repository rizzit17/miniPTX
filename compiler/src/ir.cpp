#include "miniptx.hpp"

namespace miniptx {
namespace {
std::string operation(TokenKind kind) {
    switch(kind) {
    case TokenKind::Plus: return "add"; case TokenKind::Minus: return "sub";
    case TokenKind::Star: return "mul"; case TokenKind::Slash: return "div";
    default: throw std::logic_error("Invalid IR operator");
    }
}
struct Operand { std::string text; bool constant; std::int32_t value; };
class Lowerer {
    bool optimize;
    unsigned next = 0;
    std::vector<Instruction> instructions;
    std::vector<Optimization>& changes;
    Operand expression(const Expr& e) {
        if(e.kind==ExprKind::Literal) return {std::to_string(e.value),true,e.value};
        if(e.kind==ExprKind::Identifier) return {"$"+e.name,false,0};
        auto a=expression(*e.left); auto b=expression(*e.right);
        const auto op=operation(e.op);
        if(optimize && a.constant && b.constant) {
            const auto value=checked(e.op,a.value,b.value,e.operator_span);
            changes.push_back({op+" "+a.text+", "+b.text,std::to_string(value),e.span});
            return {std::to_string(value),true,value};
        }
        auto destination="%t"+std::to_string(next++);
        instructions.push_back({destination,op,a.text,b.text,e.span});
        return {destination,false,0};
    }
public:
    Lowerer(bool enabled,std::vector<Optimization>& c) : optimize(enabled),changes(c) {}
    std::vector<Instruction> run(const Program& p) {
        for(const auto& d:p) {
            auto operand=expression(*d.expression);
            instructions.push_back({"$"+d.name,"mov",operand.text,"",d.span});
        }
        return instructions;
    }
};
}
std::vector<Instruction> lower(const Program& program,bool optimize,std::vector<Optimization>& changes) {
    return Lowerer(optimize,changes).run(program);
}
}
