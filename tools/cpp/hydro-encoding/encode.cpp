// Standalone encoder for the existing Hydro v4 feature payload contract.
#include <pandoeditor/losslessjson.h>
#include <zlib.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <iterator>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using Value=pandoeditor::codecjson::Value;
using Bytes=std::vector<std::uint8_t>;
namespace {
const Value& field(const Value& value,const char* name){
  if(value.kind!=Value::Object)throw std::invalid_argument("Hydro feature object required");
  const auto it=value.object.find(name);if(it==value.object.end())throw std::invalid_argument(std::string("Missing Hydro field: ")+name);return it->second;
}
const std::vector<Value>& array(const Value& value){if(value.kind!=Value::Array)throw std::invalid_argument("Hydro array required");return value.array;}
std::string string(const Value& value){if(value.kind!=Value::String)throw std::invalid_argument("Hydro string required");return value.string;}
double number(const Value& value){const double n=pandoeditor::codecjson::finiteNumber(value);if(!std::isfinite(n))throw std::invalid_argument("Nonfinite Hydro number");return n;}
std::uint32_t uint(const Value& value,std::uint32_t max){const double n=number(value);if(n<0||n>max||std::trunc(n)!=n)throw std::invalid_argument("Invalid Hydro integer");return static_cast<std::uint32_t>(n);}
std::int64_t even(double n){if(!std::isfinite(n)||n<double(std::numeric_limits<std::int32_t>::min())-1||n>double(std::numeric_limits<std::int32_t>::max())+1)throw std::invalid_argument("Hydro quantization out of range");
  const auto lower=std::floor(n),fraction=n-lower;auto result=static_cast<std::int64_t>(lower);if(fraction>0.5||(fraction==0.5&&result%2))++result;return result;}
void uvar(Bytes& out,std::uint64_t n){while(n>=128){out.push_back(std::uint8_t(n&127)|128);n>>=7;}out.push_back(std::uint8_t(n));}
void svar(Bytes& out,std::int64_t n){if(n<std::numeric_limits<std::int32_t>::min()||n>std::numeric_limits<std::int32_t>::max())throw std::invalid_argument("Hydro delta exceeds int32");
  uvar(out,n<0?std::uint64_t(-n*2-1):std::uint64_t(n*2));}
void little(Bytes& out,std::uint32_t n,int size){for(int i=0;i<size;i++)out.push_back(std::uint8_t(n>>(i*8)));}
void line(Bytes& out,const Value& value){const auto& points=array(value);uvar(out,points.size());std::int64_t px=0,py=0;
  for(const auto& point:points){const auto& xy=array(point);if(xy.size()<2)throw std::invalid_argument("Hydro point needs two coordinates");
    double lon=std::fmod(number(xy[0])+180.0,360.0);if(lon<0)lon+=360.0;lon-=180.0;if(lon==-180.0)lon=180.0;
    const auto x=even(lon*1000000),y=even(std::clamp(number(xy[1]),-90.0,90.0)*1000000);
    svar(out,x-px);svar(out,y-py);px=x;py=y;
  }
}
Bytes geometry(const Value& shape){const auto kind=string(field(shape,"type"));const auto& coords=field(shape,"coordinates");Bytes out;
  if(kind=="LineString"){uvar(out,1);line(out,coords);}
  else if(kind=="MultiLineString"){uvar(out,array(coords).size());for(const auto& part:array(coords))line(out,part);}
  else if(kind=="Polygon"){uvar(out,1);uvar(out,array(coords).size());for(const auto& ring:array(coords))line(out,ring);}
  else if(kind=="MultiPolygon"){uvar(out,array(coords).size());for(const auto& polygon:array(coords)){uvar(out,array(polygon).size());for(const auto& ring:array(polygon))line(out,ring);}}
  else throw std::invalid_argument("Unsupported Hydro geometry");return out;
}
Bytes widths(const Value& feature,const Value& shape){Bytes out;if(string(field(feature,"category"))!="river")return out;
  const auto kind=string(field(shape,"type"));const auto& coords=field(shape,"coordinates");const auto& values=field(feature,"width_profile");
  std::vector<const Value*> parts;if(kind=="LineString")parts.push_back(&coords);else if(kind=="MultiLineString")for(const auto& part:array(coords))parts.push_back(&part);
  const std::vector<Value> empty;const auto& profiles=values.kind==Value::Null?empty:array(values);
  if(parts.size()!=profiles.size())throw std::invalid_argument("Hydro width part count differs");uvar(out,parts.size());
  for(std::size_t i=0;i<parts.size();i++){const auto& profile=array(profiles[i]);if(profile.size()!=array(*parts[i]).size())throw std::invalid_argument("Hydro width vertex count differs");
    uvar(out,profile.size());std::int64_t previous=0;for(std::size_t j=0;j<profile.size();j++){
      const auto current=even(std::clamp(number(profile[j]),0.0,65.535)*1000);if(!j)uvar(out,current);else svar(out,current-previous);previous=current;}}
  return out;
}
Bytes sourceIds(const Value& feature){Bytes out;if(string(field(feature,"category"))!="river")return out;const auto text=string(field(feature,"source_id"));
  if(text.empty())return out;std::vector<std::int64_t> ids;std::size_t begin=0;
  while(begin<=text.size()){const auto end=text.find(',',begin);const auto part=text.substr(begin,end==std::string::npos?end:end-begin);
    if(!part.empty()){std::size_t used=0;const auto id=std::stoll(part,&used);if(used!=part.size()||id<0||id>std::numeric_limits<std::int32_t>::max())throw std::invalid_argument("Invalid Hydro source id");ids.push_back(id);}
    if(end==std::string::npos)break;begin=end+1;}
  uvar(out,ids.size());if(!ids.empty()){uvar(out,ids[0]);for(std::size_t i=1;i<ids.size();i++)svar(out,ids[i]-ids[i-1]);}return out;
}
Bytes encode(const Value& feature){const auto& shape=field(feature,"geometry");const auto kind=string(field(shape,"type")),category=string(field(feature,"category"));
  const std::uint8_t geometryKind=kind=="LineString"?1:kind=="MultiLineString"?2:kind=="Polygon"?3:kind=="MultiPolygon"?4:0;
  if(!geometryKind)throw std::invalid_argument("Unsupported Hydro geometry");const auto payload=geometry(shape),profile=widths(feature,shape);Bytes out;
  little(out,uint(field(feature,"fid"),0xffffffff),4);little(out,uint(field(feature,"logical_fid"),0xffffffff),4);
  little(out,category=="river"?1:2,1);little(out,uint(field(feature,"stage"),255),1);little(out,geometryKind,1);little(out,uint(field(feature,"flags"),255),1);
  little(out,uint(field(feature,"fragment_index"),65535),2);little(out,uint(field(feature,"fragment_count"),65535),2);
  const float width=static_cast<float>(number(field(feature,"width")));if(!std::isfinite(width))throw std::invalid_argument("Hydro width out of range");
  std::uint32_t bits;std::memcpy(&bits,&width,4);little(out,bits,4);const auto& bounds=array(field(feature,"bounds"));if(bounds.size()!=4)throw std::invalid_argument("Hydro bounds required");
  for(const auto& bound:bounds){const auto n=even(number(bound)*1000000);if(n<std::numeric_limits<std::int32_t>::min()||n>std::numeric_limits<std::int32_t>::max())throw std::invalid_argument("Hydro bounds out of range");little(out,static_cast<std::uint32_t>(static_cast<std::int32_t>(n)),4);}
  if(payload.size()>0xffffffff||profile.size()>0xffffffff)throw std::invalid_argument("Hydro payload too large");
  little(out,static_cast<std::uint32_t>(payload.size()),4);little(out,static_cast<std::uint32_t>(profile.size()),4);
  out.insert(out.end(),payload.begin(),payload.end());out.insert(out.end(),profile.begin(),profile.end());return out;
}
std::string hex(const Bytes& bytes){static const char* digits="0123456789abcdef";std::string out;out.reserve(bytes.size()*2);for(auto b:bytes){out.push_back(digits[b>>4]);out.push_back(digits[b&15]);}return out;}
Bytes unhex(const std::string& text){if(text.size()%2||text.size()>64*1024*1024)throw std::invalid_argument("Invalid Hydro gzip input");Bytes out;out.reserve(text.size()/2);
  auto digit=[](char c)->int{if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw std::invalid_argument("Invalid Hydro gzip hex");};
  for(std::size_t i=0;i<text.size();i+=2)out.push_back(std::uint8_t((digit(text[i])<<4)|digit(text[i+1])));return out;}
Bytes gzip(const Bytes& input){z_stream stream{};if(deflateInit2(&stream,9,Z_DEFLATED,MAX_WBITS+16,8,Z_DEFAULT_STRATEGY)!=Z_OK)throw std::runtime_error("Hydro gzip initialization failed");
  const auto bound=deflateBound(&stream,static_cast<uLong>(input.size()));Bytes output(bound);stream.next_in=const_cast<Bytef*>(input.data());
  stream.avail_in=static_cast<uInt>(input.size());stream.next_out=output.data();stream.avail_out=static_cast<uInt>(output.size());
  const auto status=deflate(&stream,Z_FINISH);const auto length=stream.total_out;const auto finish=deflateEnd(&stream);
  if(status!=Z_STREAM_END||finish!=Z_OK)throw std::runtime_error("Hydro gzip compression failed");output.resize(length);return output;}
}
int main(){try{const std::string input{std::istreambuf_iterator<char>(std::cin),std::istreambuf_iterator<char>()};
  if(input.size()>512*1024*1024)throw std::invalid_argument("Hydro encoding request exceeds budget");const auto request=pandoeditor::codecjson::parse(input);
  const auto mode=request.object.find("mode");if(mode!=request.object.end()){
    if(string(mode->second)!="gzip")throw std::invalid_argument("Invalid Hydro encoding mode");auto result=Value::obj(),items=Value::arr();
    for(const auto& value:array(field(request,"payloads")))items.array.push_back(Value::str(hex(gzip(unhex(string(value))))));
    result.object["payloads"]=std::move(items);std::cout<<result.encode()<<'\n';return 0;}
  auto result=Value::obj(),items=Value::arr();for(const auto& feature:array(field(request,"features"))){auto row=Value::obj();
    row.object["featureHex"]=Value::str(hex(encode(feature)));row.object["sourceIdsHex"]=Value::str(hex(sourceIds(feature)));items.array.push_back(std::move(row));}
  result.object["features"]=std::move(items);std::cout<<result.encode()<<'\n';return 0;
}catch(const std::exception& error){std::cerr<<"hydro-encoding: "<<error.what()<<'\n';return 1;}}
