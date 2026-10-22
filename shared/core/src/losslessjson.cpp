#include <pandoeditor/losslessjson.h>
#include <array>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <limits>

namespace pandoeditor::codecjson {
namespace {
void utf8(std::string& output,std::uint32_t code) {
    if(code<0x80)output+=static_cast<char>(code);
    else if(code<0x800) { output+=static_cast<char>(0xc0|(code>>6));output+=static_cast<char>(0x80|(code&63)); }
    else if(code<0x10000) {
        output+=static_cast<char>(0xe0|(code>>12));output+=static_cast<char>(0x80|((code>>6)&63));output+=static_cast<char>(0x80|(code&63));
    } else {
        output+=static_cast<char>(0xf0|(code>>18));output+=static_cast<char>(0x80|((code>>12)&63));
        output+=static_cast<char>(0x80|((code>>6)&63));output+=static_cast<char>(0x80|(code&63));
    }
}
std::uint32_t codepoint(const std::string& text,std::size_t& at,bool allowSurrogate=false) {
    const auto start=at;const auto first=static_cast<unsigned char>(text.at(at++));
    if(first<0x80)return first;
    unsigned count=0;std::uint32_t code=0,minimum=0;
    if(first>=0xc2&&first<=0xdf){count=1;code=first&31;minimum=0x80;}
    else if(first>=0xe0&&first<=0xef){count=2;code=first&15;minimum=0x800;}
    else if(first>=0xf0&&first<=0xf4){count=3;code=first&7;minimum=0x10000;}
    else throw std::invalid_argument("INVALID_JSON: invalid UTF-8");
    require(at+count<=text.size(),"INVALID_JSON: truncated UTF-8");
    while(count--) { const auto c=static_cast<unsigned char>(text[at++]);require((c&0xc0)==0x80,"INVALID_JSON: invalid UTF-8");code=(code<<6)|(c&63); }
    require(code>=minimum&&code<=0x10ffff&&(allowSurrogate||code<0xd800||code>0xdfff),"INVALID_JSON: invalid UTF-8");
    require(at>start,"INVALID_JSON: invalid UTF-8");return code;
}
void escapeUnit(std::string& output,std::uint32_t code) {
    constexpr char hex[]="0123456789abcdef";
    output+="\\u";for(int shift=12;shift>=0;shift-=4)output+=hex[(code>>shift)&15];
}
std::string quoted(const std::string& text) {
    std::string output="\"";
    for(std::size_t at=0;at<text.size();) {
        const auto start=at;const auto code=codepoint(text,at,true);
        switch(code) {
        case '"':output+="\\\"";break;case '\\':output+="\\\\";break;
        case '\b':output+="\\b";break;case '\f':output+="\\f";break;
        case '\n':output+="\\n";break;case '\r':output+="\\r";break;case '\t':output+="\\t";break;
        default:if(code<32||(code>=0xd800&&code<=0xdfff))escapeUnit(output,code);
            else output.append(text,start,at-start);
        }
    }
    output+='"';return output;
}
class Parser {
    const std::string& data;std::size_t pos=0;
    void ws() { while(pos<data.size()&&(data[pos]==' '||data[pos]=='\r'||data[pos]=='\n'||data[pos]=='\t'))++pos; }
    bool digit() const { return pos<data.size()&&data[pos]>='0'&&data[pos]<='9'; }
    std::uint32_t unit() {
        require(pos+4<=data.size(),"INVALID_JSON: truncated Unicode escape");std::uint32_t result=0;
        for(int i=0;i<4;++i) {
            const auto c=data[pos++];unsigned nibble=0;
            if(c>='0'&&c<='9')nibble=c-'0';else if(c>='a'&&c<='f')nibble=c-'a'+10;
            else if(c>='A'&&c<='F')nibble=c-'A'+10;else throw std::invalid_argument("INVALID_JSON: invalid Unicode escape");
            result=(result<<4)|nibble;
        }
        return result;
    }
    Value string() {
        const auto start=pos++;Value value;value.kind=Value::String;bool closed=false;
        while(pos<data.size()) {
            const auto first=static_cast<unsigned char>(data[pos++]);
            if(first=='"'){closed=true;break;}
            require(first>=32,"INVALID_JSON: control character");
            if(first=='\\') {
                require(pos<data.size(),"INVALID_JSON: truncated escape");const auto escaped=data[pos++];
                switch(escaped) {
                case '"':case '\\':case '/':value.string+=escaped;break;
                case 'b':value.string+='\b';break;case 'f':value.string+='\f';break;
                case 'n':value.string+='\n';break;case 'r':value.string+='\r';break;case 't':value.string+='\t';break;
                case 'u': {
                    auto code=unit();
                    if(code>=0xd800&&code<=0xdbff&&pos+6<=data.size()&&data.compare(pos,2,"\\u")==0) {
                        const auto saved=pos;pos+=2;const auto low=unit();
                        if(low>=0xdc00&&low<=0xdfff)code=0x10000+((code-0xd800)<<10)+(low-0xdc00);
                        else pos=saved;
                    }
                    // Qt's decoded QString::toStdString replaces an unpaired
                    // UTF-16 unit with '?'. Web JSON retains that unit. This is
                    // applied before duplicate-key detection, never to raw tokens.
                                        utf8(value.string,code);break;
                }
                default:throw std::invalid_argument("INVALID_JSON: invalid escape");
                }
            } else if(first<128)value.string+=static_cast<char>(first);
            else { --pos;const auto from=pos;codepoint(data,pos);value.string.append(data,from,pos-from); }
        }
        require(closed,"INVALID_JSON: unterminated string");value.raw=data.substr(start,pos-start);return value;
    }
    Value value(int depth) {
        require(depth<=128,"LIMIT_EXCEEDED: JSON nesting exceeds 128");ws();require(pos<data.size(),"INVALID_JSON: missing value");
        if(data[pos]=='"')return string();
        if(data[pos]=='{'||data[pos]=='[') {
            const bool object=data[pos++]=='{';auto result=object?Value::obj():Value::arr();const char close=object?'}':']';ws();
            if(pos<data.size()&&data[pos]==close){++pos;return result;}
            while(true) {
                ws();
                if(object) {
                    require(pos<data.size()&&data[pos]=='"',"INVALID_JSON: expected key");auto key=string().string;ws();
                    require(pos<data.size()&&data[pos++]==':',"INVALID_JSON: expected colon");
                    require(!result.object.count(key),"DUPLICATE_KEY: duplicate JSON key");result.object.emplace(std::move(key),value(depth+1));
                } else result.array.push_back(value(depth+1));
                ws();require(pos<data.size(),"INVALID_JSON: unclosed container");if(data[pos]==close){++pos;return result;}
                require(data[pos++]==',',"INVALID_JSON: expected comma");
            }
        }
        for(const auto* token:{"null","true","false"}) {
            const std::string text=token;if(data.compare(pos,text.size(),text)==0) {
                pos+=text.size();Value result;result.kind=text=="null"?Value::Null:Value::Bool;result.raw=text;return result;
            }
        }
        const auto start=pos;if(data[pos]=='-')++pos;require(digit(),"INVALID_JSON: expected number");
        if(data[pos]=='0')++pos;else while(digit())++pos;
        if(pos<data.size()&&data[pos]=='.'){++pos;require(digit(),"INVALID_JSON: fraction");while(digit())++pos;}
        if(pos<data.size()&&(data[pos]=='e'||data[pos]=='E')) {
            ++pos;if(pos<data.size()&&(data[pos]=='+'||data[pos]=='-'))++pos;
            require(digit(),"INVALID_JSON: exponent");while(digit())++pos;
        }
        Value result;result.kind=Value::Number;result.raw=data.substr(start,pos-start);return result;
    }
public:
    Parser(const std::string& bytes,ParsedTextPolicy):data(bytes){}
    Value parse() {
        require(data.size()<=256ull*1024*1024,"LIMIT_EXCEEDED: JSON exceeds 256 MiB");if(data.compare(0,3,"\xef\xbb\xbf")==0)pos=3;
        auto result=value(0);ws();require(pos==data.size(),"INVALID_JSON: trailing data");return result;
    }
};
}
Value Value::obj(){Value value;value.kind=Object;return value;}
Value Value::arr(){Value value;value.kind=Array;return value;}
Value Value::str(const std::string& text){Value value;value.kind=String;value.string=text;value.raw=quoted(text);return value;}
Value Value::num(double number) {
    require(std::isfinite(number),"INVALID_JSON: nonfinite number");Value value;value.kind=Number;
    if(number==0){value.raw="0";return value;}
    // Qt FloatingPointShortest chooses whichever fixed/scientific form is
    // shorter; chars_format::general uses a different exponent window.
    std::array<char,64> buffer{};
    // QJsonValue stores exactly representable int64 values as integer tokens.
    // This is observable in native files and provenance digests.
    if(std::trunc(number)==number&&number>=-9223372036854775808.0&&number<9223372036854775808.0) {
        const auto integer=std::to_chars(buffer.data(),buffer.data()+buffer.size(),static_cast<std::int64_t>(number));
        require(integer.ec==std::errc{},"INVALID_JSON: number conversion");value.raw.assign(buffer.data(),integer.ptr);return value;
    }
    const auto result=std::to_chars(buffer.data(),buffer.data()+buffer.size(),number);
    require(result.ec==std::errc{},"INVALID_JSON: number conversion");value.raw.assign(buffer.data(),result.ptr);return value;
}
Value Value::boolean(bool value){Value result;result.kind=Bool;result.raw=value?"true":"false";return result;}
namespace {
void appendEncoded(const Value& value,std::string& output,int depth) {
    require(depth<=128,"LIMIT_EXCEEDED: encoded JSON nesting exceeds 128");
    if(value.kind!=Value::Object&&value.kind!=Value::Array){output+=value.raw;return;}
    output+=value.kind==Value::Object?'{':'[';bool first=true;
    if(value.kind==Value::Object)for(const auto& entry:value.object){
        if(!first)output+=',';first=false;output+=quoted(entry.first);output+=':';
        appendEncoded(entry.second,output,depth+1);
    }else for(const auto& entry:value.array){
        if(!first)output+=',';first=false;appendEncoded(entry,output,depth+1);
    }
    output+=value.kind==Value::Object?'}':']';
}
}
std::string Value::encode(int depth) const {
    std::string output;appendEncoded(*this,output,depth);return output;
}
Value parse(const std::string& bytes,ParsedTextPolicy policy){return Parser(bytes,policy).parse();}
double finiteNumber(const Value& value) {
    require(value.kind==Value::Number,"INVALID_JSON: expected numeric value");double number=0;
    if(value.raw.find_first_of(".eE")==std::string::npos) {
        std::int64_t integer=0;
        const auto parsed=std::from_chars(value.raw.data(),value.raw.data()+value.raw.size(),integer);
        if(parsed.ec==std::errc{}&&parsed.ptr==value.raw.data()+value.raw.size()) {
            if(integer==0&&!value.raw.empty()&&value.raw.front()=='-')return -0.0;
            return static_cast<double>(integer);
        }
    }
    const auto result=std::from_chars(value.raw.data(),value.raw.data()+value.raw.size(),number,std::chars_format::general);
    require(result.ec==std::errc{}&&result.ptr==value.raw.data()+value.raw.size()&&std::isfinite(number),"INVALID_JSON: nonfinite typed number");return number;
}
}
