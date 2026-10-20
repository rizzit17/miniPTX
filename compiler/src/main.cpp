#include "miniptx.hpp"
#include <iostream>

int main(int argc,char** argv) {
    bool optimize=true;
    if(argc==2 && std::string(argv[1])=="--no-optimize") optimize=false;
    else if(argc!=1) { std::cerr<<"Usage: miniptx [--no-optimize] < program.mptx\n"; return 2; }
    try {
        std::string source;
        char c;
        while(source.size()<=miniptx::MAX_SOURCE && std::cin.get(c)) source.push_back(c);
        auto result=miniptx::compile(source,optimize);
        std::cout<<miniptx::to_json(result)<<"\n";
        return result.success?0:1;
    } catch(const std::exception& e) {
        std::cerr<<"Internal compiler error: "<<e.what()<<"\n"; return 2;
    }
}
