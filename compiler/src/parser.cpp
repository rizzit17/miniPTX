#include "miniptx.hpp"
#include <limits>
#include <algorithm>

namespace miniptx {
namespace {
class Parser {
    const std::vector<Token>& tokens;
    std::size_t cursor = 0;
    unsigned depth = 0;
    const Token& current() const { return tokens.at(cursor); }
    Token take(TokenKind kind, const std::string& message) {
        if(current().kind != kind) fail("parser","EXPECTED_TOKEN",message,current().span);
        return tokens.at(cursor++);
    }
    std::unique_ptr<Expr> primary() {
        if(++depth > MAX_DEPTH) fail("parser","DEPTH_LIMIT","Expression nesting exceeds 64",current().span);
        const Token token=current();
        std::unique_ptr<Expr> node;
        if(token.kind==TokenKind::Integer || token.kind==TokenKind::Minus) {
            const bool negative=token.kind==TokenKind::Minus;
            if(negative) ++cursor;
            Token number=take(TokenKind::Integer,"Expected integer literal after '-' (unary expressions are unsupported)");
            std::int64_t value=0;
            const std::int64_t limit=negative ? 2147483648LL : 2147483647LL;
            for(char digit:number.lexeme) {
                value=value*10+(digit-'0');
                if(value>limit) fail("parser","INTEGER_OVERFLOW","Integer literal is outside signed 32-bit range",number.span);
            }
            Span span=token.span; span.length=number.span.offset+number.span.length-span.offset;
            node=std::make_unique<Expr>(ExprKind::Literal,span);
            node->value=static_cast<std::int32_t>(negative ? -value : value);
        } else if(token.kind==TokenKind::Identifier) {
            ++cursor; node=std::make_unique<Expr>(ExprKind::Identifier,token.span); node->name=token.lexeme;
        } else if(token.kind==TokenKind::LParen) {
            ++cursor; node=expression();
            auto end=take(TokenKind::RParen,"Expected ')' after expression");
            node->span={token.span.offset,end.span.offset+end.span.length-token.span.offset,token.span.line,token.span.column};
        } else fail("parser","EXPECTED_EXPRESSION","Expected an integer, identifier, or '('",token.span);
        --depth;
        return node;
    }
    std::unique_ptr<Expr> binary(std::unique_ptr<Expr> left, Token op, std::unique_ptr<Expr> right) {
        const unsigned height=1+std::max(left->height,right->height);
        if(height>MAX_DEPTH) fail("parser","DEPTH_LIMIT","AST depth exceeds 64",op.span);
        auto node=std::make_unique<Expr>(ExprKind::Binary,left->span);
        node->height=height;
        node->span.length=right->span.offset+right->span.length-node->span.offset;
        node->op=op.kind; node->operator_span=op.span;
        node->left=std::move(left); node->right=std::move(right);
        return node;
    }
    std::unique_ptr<Expr> term() {
        auto node=primary();
        unsigned chain=0;
        while(current().kind==TokenKind::Star || current().kind==TokenKind::Slash) {
            if(++chain>MAX_DEPTH) fail("parser","DEPTH_LIMIT","Operator chain exceeds 64",current().span);
            auto op=tokens.at(cursor++); auto right=primary();
            node=binary(std::move(node),op,std::move(right));
        }
        return node;
    }
    std::unique_ptr<Expr> expression() {
        auto node=term();
        unsigned chain=0;
        while(current().kind==TokenKind::Plus || current().kind==TokenKind::Minus) {
            if(++chain>MAX_DEPTH) fail("parser","DEPTH_LIMIT","Operator chain exceeds 64",current().span);
            auto op=tokens.at(cursor++); auto right=term();
            node=binary(std::move(node),op,std::move(right));
        }
        return node;
    }
public:
    explicit Parser(const std::vector<Token>& t) : tokens(t) {}
    Program run() {
        Program program;
        while(current().kind!=TokenKind::End) {
            take(TokenKind::Let,"Expected 'let' to start a declaration");
            Token name=take(TokenKind::Identifier,"Expected variable name after 'let'");
            take(TokenKind::Equal,"Expected '=' after variable name");
            auto expr=expression();
            take(TokenKind::Semicolon,"Expected ';' after declaration");
            program.push_back({name.lexeme,name.span,std::move(expr)});
        }
        return program;
    }
};
}
Program parse(const std::vector<Token>& tokens) { return Parser(tokens).run(); }
}
