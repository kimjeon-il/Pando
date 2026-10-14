#pragma once
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace pandoeditor::codecjson {
// Parsed fields/keys have platform-specific text semantics. Opaque scalar
// tokens retain their original bytes under both policies.
enum class ParsedTextPolicy { PreserveUtf16, QtUtf8 };
inline void require(bool value,const char* error) { if(!value)throw std::invalid_argument(error); }
// A codec value, never an editable document or a second model owner. Opaque
// scalar tokens stay exact; interpreted fields are decoded at the codec boundary.
struct Value {
    enum Kind { Null,Bool,Number,String,Array,Object } kind=Null;
    std::string raw="null",string;
    std::vector<Value> array;
    std::map<std::string,Value> object;
    static Value obj();
    static Value arr();
    static Value str(const std::string&);
    static Value num(double);
    static Value boolean(bool);
    std::string encode(int depth=0) const;
};
Value parse(const std::string&,ParsedTextPolicy=ParsedTextPolicy::PreserveUtf16);
double finiteNumber(const Value&);
}
