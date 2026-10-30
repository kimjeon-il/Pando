#include "resample.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace pando::map_image {
namespace {
constexpr int precision=22;
constexpr std::int64_t unit=std::int64_t{1}<<precision;
constexpr double pi=3.141592653589793238462643383279502884;
struct Row {int start;std::vector<std::int32_t> weights;};
double sinc(double x){return x==0?1:std::sin(pi*x)/(pi*x);}
std::vector<Row> coefficients(int input,int output){
    const double scale=static_cast<double>(input)/output,filterScale=std::max(1.0,scale),radius=3*filterScale;
    std::vector<Row> rows;rows.reserve(output);
    for(int i=0;i<output;++i){
        const double center=(i+.5)*scale;
        const int begin=std::max(0,static_cast<int>(center-radius+.5));
        const int end=std::min(input,static_cast<int>(center+radius+.5));
        std::vector<double> values;values.reserve(end-begin);double total=0;
        for(int j=begin;j<end;++j){
            const double x=(j-center+.5)/filterScale;
            const double value=(x>=-3&&x<3)?sinc(x)*sinc(x/3):0;
            values.push_back(value);total+=value;
        }
        Row row{begin,{}};row.weights.reserve(values.size());
        for(double value:values)row.weights.push_back(static_cast<std::int32_t>(std::round((total==0?value:value/total)*unit)));
        rows.push_back(std::move(row));
    }
    return rows;
}
std::uint8_t rounded(std::int64_t value){
    value+=unit/2;
    if(value<=0)return 0;
    if(value>=255*unit)return 255;
    return static_cast<std::uint8_t>(value/unit);
}
void validate(int width,int height){
    if(width<=0||height<=0||width>16384||height>16384||static_cast<std::int64_t>(width)*height>16777216)
        throw std::invalid_argument("Image dimensions exceed the 16MP graph budget");
}
}
std::vector<std::uint8_t> resizeRgb(const std::vector<std::uint8_t>& input,int width,int height,int outputWidth,int outputHeight){
    validate(width,height);validate(outputWidth,outputHeight);
    if(input.size()!=static_cast<std::size_t>(width)*height*3)throw std::invalid_argument("RGB input byte length differs from dimensions");
    if(width==outputWidth&&height==outputHeight)return input;
    std::vector<std::uint8_t> horizontal;
    const std::vector<std::uint8_t>* intermediate=&input;
    if(width!=outputWidth){
        const auto weights=coefficients(width,outputWidth);
        horizontal.resize(static_cast<std::size_t>(outputWidth)*height*3);
        for(int y=0;y<height;++y)for(int x=0;x<outputWidth;++x)for(int c=0;c<3;++c){
            std::int64_t sum=0;const auto& row=weights[x];
            for(std::size_t j=0;j<row.weights.size();++j)
                sum+=static_cast<std::int64_t>(input[(static_cast<std::size_t>(y)*width+row.start+j)*3+c])*row.weights[j];
            horizontal[(static_cast<std::size_t>(y)*outputWidth+x)*3+c]=rounded(sum);
        }
        intermediate=&horizontal;
    }
    if(height==outputHeight)return *intermediate;
    const auto weights=coefficients(height,outputHeight);
    std::vector<std::uint8_t> output(static_cast<std::size_t>(outputWidth)*outputHeight*3);
    for(int y=0;y<outputHeight;++y)for(int x=0;x<outputWidth;++x)for(int c=0;c<3;++c){
        std::int64_t sum=0;const auto& row=weights[y];
        for(std::size_t j=0;j<row.weights.size();++j)
            sum+=static_cast<std::int64_t>((*intermediate)[((static_cast<std::size_t>(row.start)+j)*outputWidth+x)*3+c])*row.weights[j];
        output[(static_cast<std::size_t>(y)*outputWidth+x)*3+c]=rounded(sum);
    }
    return output;
}
}
