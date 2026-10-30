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
// Fixed-point Lanczos semantics match Pillow 12.3's 8-bit resampler:
// https://github.com/python-pillow/Pillow/blob/12.3.0/src/libImaging/Resample.c
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
static std::vector<std::uint8_t> resizeChannels(const std::vector<std::uint8_t>& input,int width,int height,int outputWidth,int outputHeight,int channels){
    validate(width,height);validate(outputWidth,outputHeight);
    if(input.size()!=static_cast<std::size_t>(width)*height*channels)throw std::invalid_argument("Input byte length differs from dimensions");
    if(width==outputWidth&&height==outputHeight)return input;
    const auto horizontalWeights=width==outputWidth?std::vector<Row>{}:coefficients(width,outputWidth);
    const auto verticalWeights=height==outputHeight?std::vector<Row>{}:coefficients(height,outputHeight);
    std::vector<std::uint8_t> output(static_cast<std::size_t>(outputWidth)*outputHeight*channels);
    // Process bounded vertical stripes; an extremely narrow input enlarged in X
    // must not allocate outputWidth * inputHeight pixels as an intermediate.
    for(int first=0;first<outputWidth;first+=64){
        const int count=std::min(64,outputWidth-first);
        std::vector<std::uint8_t> horizontal;
        if(width!=outputWidth){
            horizontal.resize(static_cast<std::size_t>(count)*height*channels);
            for(int y=0;y<height;++y)for(int x=0;x<count;++x)for(int c=0;c<channels;++c){
                std::int64_t sum=0;const auto& row=horizontalWeights[first+x];
                for(std::size_t j=0;j<row.weights.size();++j)
                    sum+=static_cast<std::int64_t>(input[(static_cast<std::size_t>(y)*width+row.start+j)*channels+c])*row.weights[j];
                horizontal[(static_cast<std::size_t>(y)*count+x)*channels+c]=rounded(sum);
            }
        }
        for(int y=0;y<outputHeight;++y)for(int x=0;x<count;++x)for(int c=0;c<channels;++c){
            const auto sample=[&](int iy){return width==outputWidth?
                input[(static_cast<std::size_t>(iy)*width+first+x)*channels+c]:horizontal[(static_cast<std::size_t>(iy)*count+x)*channels+c];};
            auto& pixel=output[(static_cast<std::size_t>(y)*outputWidth+first+x)*channels+c];
            if(height==outputHeight)pixel=sample(y);
            else{
                std::int64_t sum=0;const auto& row=verticalWeights[y];
                for(std::size_t j=0;j<row.weights.size();++j)sum+=static_cast<std::int64_t>(sample(row.start+static_cast<int>(j)))*row.weights[j];
                pixel=rounded(sum);
            }
        }
    }
    return output;
}
std::vector<std::uint8_t> resizeRgb(const std::vector<std::uint8_t>& input,int width,int height,int outputWidth,int outputHeight){
    return resizeChannels(input,width,height,outputWidth,outputHeight,3);
}
std::vector<std::uint8_t> resizeRgba(const std::vector<std::uint8_t>& input,int width,int height,int outputWidth,int outputHeight){
    validate(width,height);validate(outputWidth,outputHeight);
    if(input.size()!=static_cast<std::size_t>(width)*height*4)throw std::invalid_argument("RGBA input byte length differs from dimensions");
    if(width==outputWidth&&height==outputHeight)return input;
    auto premultiplied=input;
    for(std::size_t i=0;i<premultiplied.size();i+=4)
        for(int c=0;c<3;++c)premultiplied[i+c]=static_cast<std::uint8_t>((static_cast<int>(input[i+c])*input[i+3]+127)/255);
    auto output=resizeChannels(premultiplied,width,height,outputWidth,outputHeight,4);
    for(std::size_t i=0;i<output.size();i+=4){
        const int alpha=output[i+3];
        if(alpha!=0&&alpha!=255)for(int c=0;c<3;++c)output[i+c]=static_cast<std::uint8_t>(std::min(255,255*output[i+c]/alpha));
    }
    return output;
}
std::vector<std::uint8_t> rotateRgba(const std::vector<std::uint8_t>& input,int width,int height,int degrees){
    validate(width,height);
    if(input.size()!=static_cast<std::size_t>(width)*height*4)throw std::invalid_argument("RGBA input byte length differs from dimensions");
    if(degrees!=0&&degrees!=90&&degrees!=180&&degrees!=270)throw std::invalid_argument("Invalid clockwise rotation");
    if(degrees==0)return input;
    const int outputWidth=degrees==180?width:height;
    std::vector<std::uint8_t> output(input.size());
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        const int ox=degrees==90?height-1-y:degrees==180?width-1-x:y;
        const int oy=degrees==90?x:degrees==180?height-1-y:width-1-x;
        const auto source=(static_cast<std::size_t>(y)*width+x)*4,destination=(static_cast<std::size_t>(oy)*outputWidth+ox)*4;
        std::copy_n(input.begin()+source,4,output.begin()+destination);
    }
    return output;
}
}
