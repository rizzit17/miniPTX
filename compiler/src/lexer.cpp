#include "miniptx.hpp"
#include <cctype>

namespace miniptx {
[[noreturn]] void fail(const std::string& stage, const std::string& code, const std::string& message, Span span) {
    throw CompileError({stage, code, message, span});
}
std::string token_name(TokenKind k) {
    switch(k) {
    case TokenKind::Let: return "Let"; case TokenKind::Identifier: return "Identifier";
    case TokenKind::Integer: return "Integer"; case TokenKind::Plus: return "Plus";
    case TokenKind::Minus: return "Minus"; case TokenKind::Star: return "Star";
    case TokenKind::Slash: return "Slash"; case TokenKind::Equal: return "Equal";
    case TokenKind::LParen: return "LParen"; case TokenKind::RParen: return "RParen";
    case TokenKind::Semicolon: return "Semicolon"; case TokenKind::End: return "End";
    }
    throw std::logic_error("Unknown token kind");
}
std::vector<Token> lex(const std::string& source) {
    if(source.size() > MAX_SOURCE) fail("lexer", "SOURCE_LIMIT", "Source exceeds 32768 bytes", {});
    std::vector<Token> tokens;
    std::size_t i = 0;
    unsigned line = 1, column = 1;
    auto advance = [&]() {
        const auto byte=static_cast<unsigned char>(source[i]);
        if(byte>=128 || byte==0) fail("lexer","INVALID_CHARACTER","Only ASCII source text is supported",{i,1,line,column});
        if(source[i++] == '\n') { ++line; column = 1; } else ++column;
    };
    auto peek = [&](std::size_t n) { return i+n < source.size() ? source[i+n] : '\0'; };
    while(i < source.size()) {
        Span s{i, 0, line, column};
        const auto c = static_cast<unsigned char>(source[i]);
        if(c >= 128 || c == 0) fail("lexer", "INVALID_CHARACTER", "Only ASCII source text is supported", {i,1,line,column});
        if(std::isspace(c)) { advance(); continue; }
        if(peek(0)=='/' && peek(1)=='/') { while(i<source.size() && peek(0)!='\n') advance(); continue; }
        if(peek(0)=='/' && peek(1)=='*') {
            advance(); advance();
            while(i<source.size() && !(peek(0)=='*' && peek(1)=='/')) advance();
            if(i==source.size()) fail("lexer","UNTERMINATED_COMMENT","Unterminated block comment",s);
            advance(); advance(); continue;
        }
        TokenKind kind;
        if(std::isalpha(c) || c=='_') {
            while(i<source.size() && (std::isalnum(static_cast<unsigned char>(peek(0))) || peek(0)=='_')) advance();
            kind = source.substr(s.offset,i-s.offset)=="let" ? TokenKind::Let : TokenKind::Identifier;
        } else if(std::isdigit(c)) {
            while(i<source.size() && std::isdigit(static_cast<unsigned char>(peek(0)))) advance();
            kind=TokenKind::Integer;
        } else {
            switch(c) {
            case '+': kind=TokenKind::Plus; break; case '-': kind=TokenKind::Minus; break;
            case '*': kind=TokenKind::Star; break; case '/': kind=TokenKind::Slash; break;
            case '=': kind=TokenKind::Equal; break; case '(': kind=TokenKind::LParen; break;
            case ')': kind=TokenKind::RParen; break; case ';': kind=TokenKind::Semicolon; break;
            default: fail("lexer","INVALID_CHARACTER","Unsupported character '"+std::string(1,static_cast<char>(c))+"'",{i,1,line,column});
            }
            advance();
        }
        s.length=i-s.offset;
        tokens.push_back({kind,source.substr(s.offset,s.length),s});
        if(tokens.size()>MAX_TOKENS) fail("lexer","TOKEN_LIMIT","Program exceeds 4096 tokens",s);
    }
    tokens.push_back({TokenKind::End,"",{i,0,line,column}});
    return tokens;
}
}
