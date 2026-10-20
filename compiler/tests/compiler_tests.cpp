#include "miniptx.hpp"
#include <functional>
#include <iostream>
#include <random>
#include <stdexcept>
using namespace miniptx;

void require(bool condition,const std::string& message) {
    if(!condition) throw std::runtime_error(message);
}
void error(const std::string& source,const std::string& code) {
    auto r=compile(source);
    require(!r.success,"Invalid program accepted: "+source);
    require(!r.diagnostics.empty() && r.diagnostics[0].code==code,"Wrong diagnostic for "+source);
    require(r.ptx.empty(),"Invalid source produced PTX");
}
// Independent IR interpreter: checks lowering and optimization against arithmetic expectations.
std::map<std::string,std::int64_t> interpret(const std::vector<Instruction>& ir) {
    std::map<std::string,std::int64_t> values;
    auto get=[&](const std::string& s) { return s[0]=='$' || s[0]=='%' ? values.at(s) : std::stoll(s); };
    for(const auto& i:ir) {
        auto a=get(i.left); auto b=i.right.empty()?0:get(i.right);
        std::int64_t v=0;
        if(i.op=="mov") v=a;
        else if(i.op=="add") v=a+b;
        else if(i.op=="sub") v=a-b;
        else if(i.op=="mul") v=a*b;
        else if(i.op=="div") v=a/b;
        else throw std::runtime_error("Unknown IR operation");
        values[i.destination]=v;
    }
    return values;
}
int main() {
    unsigned passed=0,failed=0;
    auto test=[&](const std::string& name,const std::function<void()>& run) {
        try { run(); ++passed; std::cout<<"PASS "<<name<<"\n"; }
        catch(const std::exception& e) { ++failed; std::cerr<<"FAIL "<<name<<": "<<e.what()<<"\n"; }
    };
    test("typed tokens and source positions",[] {
        auto t=lex("// comment\n  let x = 12;");
        require(t.size()==6,"token count"); require(t[0].kind==TokenKind::Let,"let token");
        require(t[0].span.line==2 && t[0].span.column==3 && t[0].span.offset==13,"let position");
        require(t[3].lexeme=="12" && t[3].span.length==2,"integer span");
    });
    test("comments and whitespace",[] { require(compile(" \r\n/* block\ncomment */ let _x2 = 2;// end").success,"comments"); });
    test("invalid characters",[] { error("let x = @;","INVALID_CHARACTER"); });
    test("non-ASCII in comments is rejected",[] { error("// \xc3\xa9\nlet x=1;","INVALID_CHARACTER"); });
    test("unterminated comment",[] { error("/*","UNTERMINATED_COMMENT"); });
    test("operator precedence",[] {
        auto r=compile("let x = 10 + 20 * 3;");
        require(r.success && r.ast[0].expression->op==TokenKind::Plus,"root operator");
        require(r.ast[0].expression->right->op==TokenKind::Star,"nested multiply");
        require(interpret(r.ir).at("$x")==70,"precedence result");
    });
    test("parentheses",[] { auto r=compile("let x = (10 + 20) * 3;"); require(r.success && interpret(r.ir).at("$x")==90,"grouped result"); });
    test("left associativity",[] { auto r=compile("let x = 24 / 3 / 2; let y = 10 - 3 - 2;"); require(interpret(r.ir).at("$x")==4 && interpret(r.ir).at("$y")==5,"associativity"); });
    test("multiple declarations",[] { auto r=compile("let a = 2; let b = a * 3;"); require(r.ast.size()==2 && interpret(r.ir).at("$b")==6,"declarations"); });
    test("missing semicolon location",[] { auto r=compile("let x = 1\nlet y = 2;"); require(!r.success && r.diagnostics[0].span.line==2 && r.diagnostics[0].span.column==1,"diagnostic position"); });
    test("missing expression",[] { error("let x = ;","EXPECTED_EXPRESSION"); });
    test("unsupported assignment",[] { error("let x = 1; x = 2;","EXPECTED_TOKEN"); });
    test("undefined variables",[] { error("let x = y + 1;","UNDEFINED_VARIABLE"); });
    test("self references",[] { error("let x = x;","UNDEFINED_VARIABLE"); });
    test("duplicates",[] { error("let x = 1; let x = 2;","DUPLICATE_DECLARATION"); });
    test("literal division by zero",[] { error("let x = 1 / 0;","DIVISION_BY_ZERO"); });
    test("identifier division by zero",[] { error("let a = 1 - 1; let b = 10 / a;","DIVISION_BY_ZERO"); });
    test("i32 boundaries",[] { auto r=compile("let min = -2147483648; let max = 2147483647;"); require(r.success,"boundaries"); });
    test("literal overflow",[] { error("let x = 2147483648;","INTEGER_OVERFLOW"); error("let x = -2147483649;","INTEGER_OVERFLOW"); error("let x = 999999999999999999999999;","INTEGER_OVERFLOW"); });
    test("arithmetic overflow",[] { error("let x = 2147483647 + 1;","ARITHMETIC_OVERFLOW"); error("let x = -2147483648 - 1;","ARITHMETIC_OVERFLOW"); error("let x = 50000 * 50000;","ARITHMETIC_OVERFLOW"); });
    test("division overflow",[] { error("let x = -2147483648 / -1;","ARITHMETIC_OVERFLOW"); });
    test("division truncates toward zero",[] { auto r=compile("let x = -7 / 3;"); require(r.success && interpret(r.optimized_ir).at("$x")==-2,"signed division"); });
    test("nested folding",[] { auto r=compile("let x = (10 + 20) * (8 - 5);"); require(r.success && r.ir.size()==4 && r.optimized_ir.size()==1 && r.optimizations.size()==3,"fold count"); require(r.optimized_ir[0].left=="90","folded value"); });
    test("optimization toggle",[] { auto r=compile("let x = 10 + 20 * 3;",false); require(r.optimizations.empty() && r.optimized_ir.size()==r.ir.size(),"disabled folding"); require(r.ptx.find("mul.lo.s32")!=std::string::npos,"multiply preserved"); });
    test("identifier and temporary namespaces",[] { auto r=compile("let t0 = 2; let r0 = t0 + 3; let output = r0 * t0;"); require(r.success && interpret(r.ir).at("$output")==10,"name collision"); });
    test("PTX directives, registers, instruction selection, stores",[] {
        auto r=compile("let a = 12; let b = a + 2; let c = b - 1; let d = c * 2; let e = d / 3;");
        require(r.success && structurally_valid(r.ptx),"structure");
        for(const auto& s:{"add.s32","sub.s32","mul.lo.s32","div.s32",".reg .b64","st.global.s32 [%rd1+16]","cvta.to.global.u64"})
            require(r.ptx.find(s)!=std::string::npos,s);
    });
    test("empty program",[] { auto r=compile(""); require(r.success && r.ast.empty() && structurally_valid(r.ptx),"empty program"); });
    test("bounded source",[] { error(std::string(MAX_SOURCE+1,' '),"SOURCE_LIMIT"); });
    test("bounded tokens",[] { error(std::string(4097,'+'),"TOKEN_LIMIT"); });
    test("bounded nesting",[] { error("let x = "+std::string(130,'(')+"1"+std::string(130,')')+";","DEPTH_LIMIT"); });
    test("bounded left deep AST",[] { std::string s="let x = 1"; for(int i=0;i<130;++i) s+="+1"; error(s+";","DEPTH_LIMIT"); });
    test("deterministic property checks: 250 arithmetic programs",[] {
        std::mt19937 random(42);
        for(int i=0;i<250;++i) {
            auto a=int(random()%100)-50, b=int(random()%100)-50, c=int(random()%10)+1;
            auto r=compile("let a = "+std::to_string(a)+"; let result = a + ("+std::to_string(b)+" * "+std::to_string(c)+") / "+std::to_string(c)+";");
            require(r.success,"random program");
            require(interpret(r.ir).at("$result")==a+b,"original IR semantics");
            require(interpret(r.optimized_ir).at("$result")==a+b,"optimized IR semantics");
        }
    });
    std::cout<<passed<<" tests passed, "<<failed<<" failed\n";
    return failed?1:0;
}
