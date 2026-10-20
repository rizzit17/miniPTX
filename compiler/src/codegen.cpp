#include "miniptx.hpp"
#include <sstream>

namespace miniptx {
std::string generate_ptx(const std::vector<Instruction>& ir) {
    std::ostringstream out;
    out<<"// MiniPTX educational compiler. Launch exactly one thread.\n"
       <<".version 7.0\n.target sm_75\n.address_size 64\n\n"
       <<".visible .entry miniptx_kernel(\n    .param .u64 output\n)\n{\n"
       <<"    .reg .b64 %rd<2>;\n    .reg .b32 %r<"<<(ir.size()+1)<<">;\n\n"
       <<"    ld.param.u64 %rd0, [output];\n    cvta.to.global.u64 %rd1, %rd0;\n";
    std::map<std::string,std::string> registers;
    std::size_t index=0, output_index=0;
    auto operand=[&](const std::string& value) {
        if(!value.empty() && (value[0]=='$' || value[0]=='%')) return registers.at(value);
        return value;
    };
    for(const auto& instruction:ir) {
        const auto left=operand(instruction.left);
        const auto right=instruction.right.empty() ? "" : operand(instruction.right);
        const auto reg="%r"+std::to_string(index++);
        registers[instruction.destination]=reg;
        std::string mnemonic=instruction.op== "mul" ? "mul.lo.s32" : instruction.op+".s32";
        out<<"    "<<mnemonic<<" "<<reg<<", "<<left;
        if(!right.empty()) out<<", "<<right;
        out<<";\n";
        if(instruction.destination[0]=='$') {
            out<<"    st.global.s32 [%rd1+"<<(output_index++*4)<<"], "<<reg<<"; // "<<instruction.destination.substr(1)<<"\n";
        }
    }
    out<<"    ret;\n}\n";
    return out.str();
}
bool structurally_valid(const std::string& ptx) {
    return ptx.find(".version 7.0\n.target sm_75\n.address_size 64")!=std::string::npos &&
           ptx.find(".visible .entry miniptx_kernel(")!=std::string::npos &&
           ptx.find(".reg .b32 %r<")!=std::string::npos &&
           ptx.find("    ret;\n}\n")!=std::string::npos;
}
}
