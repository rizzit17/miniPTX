#include "miniptx.hpp"
#include <iomanip>
#include <sstream>

namespace miniptx {
Result compile(const std::string& source,bool optimize) {
    Result r;
    try {
        r.tokens=lex(source);
        r.ast=parse(r.tokens);
        analyze(r.ast);
        std::vector<Optimization> ignored;
        r.ir=lower(r.ast,false,ignored);
        r.optimized_ir=lower(r.ast,optimize,r.optimizations);
        r.ptx=generate_ptx(r.optimized_ir);
        if(!structurally_valid(r.ptx)) throw std::logic_error("PTX structural check failed");
        r.success=true;
    } catch(const CompileError& e) { r.diagnostics.push_back(e.diagnostic); }
    return r;
}
namespace {
std::string quote(const std::string& value) {
    std::ostringstream out; out<<'"';
    for(unsigned char c:value) {
        if(c=='"' || c=='\\') out<<'\\'<<c;
        else if(c<32 || c>=127) out<<"\\u"<<std::hex<<std::setw(4)<<std::setfill('0')<<static_cast<unsigned>(c)<<std::dec;
        else out<<c;
    }
    out<<'"'; return out.str();
}
std::string span(Span s) {
    return "{\"offset\":"+std::to_string(s.offset)+",\"length\":"+std::to_string(s.length)+
           ",\"line\":"+std::to_string(s.line)+",\"column\":"+std::to_string(s.column)+"}";
}
std::string expr(const Expr& e) {
    std::string s="{\"span\":"+span(e.span);
    if(e.kind==ExprKind::Literal) s+=",\"kind\":\"Literal\",\"value\":"+std::to_string(e.value);
    else if(e.kind==ExprKind::Identifier) s+=",\"kind\":\"Identifier\",\"name\":"+quote(e.name);
    else s+=",\"kind\":\"Binary\",\"operator\":"+quote(token_name(e.op))+",\"left\":"+expr(*e.left)+",\"right\":"+expr(*e.right);
    return s+"}";
}
template<typename T,typename F> std::string array(const std::vector<T>& items,F serialize) {
    std::string out="["; bool first=true;
    for(const auto& item:items) { if(!first) out+=","; first=false; out+=serialize(item); }
    return out+"]";
}
std::string instructions(const std::vector<Instruction>& items) {
    return array(items,[](const Instruction& i) {
        return "{\"destination\":"+quote(i.destination)+",\"op\":"+quote(i.op)+",\"left\":"+quote(i.left)+",\"right\":"+quote(i.right)+",\"span\":"+span(i.span)+"}";
    });
}
}
std::string to_json(const Result& r) {
    return std::string("{\"success\":")+(r.success?"true":"false")+
        ",\"tokens\":"+array(r.tokens,[](const Token& t) { return "{\"kind\":"+quote(token_name(t.kind))+",\"lexeme\":"+quote(t.lexeme)+",\"span\":"+span(t.span)+"}"; })+
        ",\"ast\":"+array(r.ast,[](const Declaration& d) { return "{\"kind\":\"Declaration\",\"name\":"+quote(d.name)+",\"span\":"+span(d.span)+",\"expression\":"+expr(*d.expression)+"}"; })+
        ",\"ir\":"+instructions(r.ir)+",\"optimized_ir\":"+instructions(r.optimized_ir)+
        ",\"optimizations\":"+array(r.optimizations,[](const Optimization& o) { return "{\"before\":"+quote(o.before)+",\"after\":"+quote(o.after)+",\"span\":"+span(o.span)+"}"; })+
        ",\"ptx\":"+quote(r.ptx)+",\"diagnostics\":"+array(r.diagnostics,[](const Diagnostic& d) {
            return "{\"severity\":\"error\",\"stage\":"+quote(d.stage)+",\"code\":"+quote(d.code)+",\"message\":"+quote(d.message)+",\"span\":"+span(d.span)+"}";
        })+"}";
}
}
