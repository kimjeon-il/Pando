#include "resample.h"
#include "png.h"
#include "image-input.h"
#include "image-read.h"
#include "training-scan.h"
#include "training-tile.h"
#include <webp/encode.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
namespace {
int dimension(const char* value){
    const std::string text(value);std::size_t used=0;const int number=std::stoi(text,&used);
    if(used!=text.size()||number<1||number>16384)throw std::invalid_argument("Invalid image dimension");
    return number;
}
int bounded(const char* value,int maximum){
    const std::string text(value);std::size_t used=0;const int number=std::stoi(text,&used);
    if(used!=text.size()||number<0||number>maximum)throw std::invalid_argument("Invalid bounded image argument");
    return number;
}
std::uint64_t index64(const char* raw){const std::string text(raw);std::size_t used=0;
    if(text.empty()||text.find_first_not_of("0123456789")!=std::string::npos)throw std::invalid_argument("Invalid training index");
    const auto value=std::stoull(text,&used);if(used!=text.size())throw std::invalid_argument("Invalid training index");return value;
}
void number(std::uint32_t value){
    const std::array<char,4> bytes{static_cast<char>(value>>24),static_cast<char>(value>>16),static_cast<char>(value>>8),static_cast<char>(value)};
    std::cout.write(bytes.data(),bytes.size());
}
std::vector<std::uint8_t> encodedInput(){
    std::vector<std::uint8_t> encoded;std::array<char,65536> buffer{};
    while(std::cin){std::cin.read(buffer.data(),buffer.size());const auto n=std::cin.gcount();
        if(n>0){if(encoded.size()+static_cast<std::size_t>(n)>300ULL*1024*1024)throw std::invalid_argument("Image input exceeds encoded byte budget");
            encoded.insert(encoded.end(),buffer.data(),buffer.data()+n);}}
    if(!std::cin.eof())throw std::runtime_error("Unable to read image input");return encoded;
}
std::pair<int,int> thumbnailSize(int width,int height,int maxWidth,int maxHeight){
    if(maxWidth>=width&&maxHeight>=height)return {width,height};
    const double aspect=static_cast<double>(width)/height;
    if(static_cast<double>(maxWidth)/maxHeight>=aspect){
        const double n=maxHeight*aspect;const int low=static_cast<int>(std::floor(n)),high=static_cast<int>(std::ceil(n));
        const int x=std::abs(aspect-static_cast<double>(high)/maxHeight)<std::abs(aspect-static_cast<double>(low)/maxHeight)?high:low;
        return {std::max(1,x),maxHeight};
    }
    const double n=maxWidth/aspect;const int low=static_cast<int>(std::floor(n)),high=static_cast<int>(std::ceil(n));
    const auto error=[&](int v){return v?std::abs(aspect-static_cast<double>(maxWidth)/v):0;};
    return {maxWidth,std::max(1,error(high)<error(low)?high:low)};
}
std::vector<std::uint8_t> encodeWebpLossless(const std::vector<std::uint8_t>& pixels,int width,int height){
    WebPConfig config;if(!WebPConfigInit(&config))throw std::runtime_error("WebP encoder version mismatch");
    config.lossless=1;config.quality=80;config.method=6;config.exact=1;
    if(!WebPValidateConfig(&config))throw std::runtime_error("Invalid lossless WebP configuration");
    struct Encoder {WebPPicture picture{};WebPMemoryWriter writer{};
        Encoder(){if(!WebPPictureInit(&picture))throw std::runtime_error("WebP picture version mismatch");WebPMemoryWriterInit(&writer);}
        ~Encoder(){WebPPictureFree(&picture);WebPMemoryWriterClear(&writer);}} encoder;
    encoder.picture.width=width;encoder.picture.height=height;encoder.picture.use_argb=1;
    encoder.picture.writer=WebPMemoryWrite;encoder.picture.custom_ptr=&encoder.writer;
    if(!WebPPictureImportRGBA(&encoder.picture,pixels.data(),width*4)||!WebPEncode(&config,&encoder.picture))
        throw std::runtime_error("Unable to encode lossless WebP");
    return {encoder.writer.mem,encoder.writer.mem+encoder.writer.size};
}
}
int main(int argc,char** argv){
    try{
#ifdef _WIN32
        if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Unable to set binary I/O");
#endif
        if(argc<2)throw std::invalid_argument("Expected resize-rgba, rotate-rgba or encode-png");
        const std::string action=argv[1];
        if(action=="semap-image"){
            if(argc!=2)throw std::invalid_argument("Semap image takes no extra arguments");
            const auto encoded=encodedInput();PandoImage image{};
            if(!pando_read_jpeg(encoded.data(),encoded.size(),&image))throw std::runtime_error(std::string("Semap JPEG: ")+image.error);
            std::unique_ptr<std::uint8_t,decltype(&std::free)> pixels(image.rgba,&std::free);
            if(image.width>1200||image.height>1200)throw std::invalid_argument("Semap real image exceeds size budget");
            const std::vector<std::uint8_t> input(pixels.get(),pixels.get()+std::size_t(image.width)*image.height*4);
            const auto reduced=pando::map_image::resizeOpaqueBicubic(input,image.width,image.height,128,128);
            std::uint32_t sum=0;for(std::size_t i=0;i<reduced.size();i+=4){const auto lo=std::min({reduced[i],reduced[i+1],reduced[i+2]});
                const auto hi=std::max({reduced[i],reduced[i+1],reduced[i+2]});sum+=hi-lo;}
            number(image.width);number(image.height);number(sum);if(!std::cout)throw std::runtime_error("Unable to write Semap image inspection");return 0;
        }
        if(action=="semap-labels"||action=="encode-gray"){
            if(argc!=4)throw std::invalid_argument("Expected grayscale WIDTH HEIGHT");
            const int width=dimension(argv[2]),height=dimension(argv[3]);const auto pixels=std::size_t(width)*height;
            if(pixels>16777216)throw std::invalid_argument("Grayscale image exceeds 16MP budget");
            std::vector<std::uint8_t> input(pixels);
            if(!std::cin.read(reinterpret_cast<char*>(input.data()),static_cast<std::streamsize>(pixels))||std::cin.peek()!=std::char_traits<char>::eof())
                throw std::invalid_argument("Grayscale input byte length differs");
            if(action=="encode-gray"){
                const auto output=pando::map_image::encodePngGray(input,width,height);
                std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
            }else{
                std::vector<std::uint8_t> target(pixels),known(pixels);std::uint32_t knownCount=0,positiveCount=0;
                for(std::size_t i=0;i<pixels;++i){const auto value=input[i];if(value>5)throw std::invalid_argument("Unknown Semap semantic class");
                    if(value>=2){known[i]=24;++knownCount;}if(value==4){target[i]=8;++positiveCount;}else if(value==5){target[i]=16;++positiveCount;}}
                number(knownCount);number(positiveCount);std::cout.write(reinterpret_cast<const char*>(target.data()),static_cast<std::streamsize>(pixels));
                std::cout.write(reinterpret_cast<const char*>(known.data()),static_cast<std::streamsize>(pixels));
            }
            if(!std::cout)throw std::runtime_error("Unable to write grayscale result");return 0;
        }
        if(action=="training-supervision"){
            if(argc!=4)throw std::invalid_argument("Expected training supervision WIDTH HEIGHT");
            const int width=dimension(argv[2]),height=dimension(argv[3]);const auto pixels=std::size_t(width)*height;
            if(pixels>16777216)throw std::invalid_argument("Training supervision exceeds 16MP budget");
            std::vector<std::uint8_t> target(pixels),known(pixels);
            if(!std::cin.read(reinterpret_cast<char*>(target.data()),static_cast<std::streamsize>(pixels))||
               !std::cin.read(reinterpret_cast<char*>(known.data()),static_cast<std::streamsize>(pixels))||std::cin.peek()!=std::char_traits<char>::eof())
                throw std::invalid_argument("Training supervision input length differs");
            std::array<std::uint32_t,7> validCount{},positiveCount{};
            for(std::size_t i=0;i<pixels;++i)for(unsigned channel=0;channel<7;++channel){const auto bit=std::uint8_t(1u<<channel);
                if(known[i]&bit){++validCount[channel];if(target[i]&bit)++positiveCount[channel];}}
            for(unsigned channel=0;channel<7;++channel){number(validCount[channel]);number(positiveCount[channel]);}
            if(!std::cout)throw std::runtime_error("Unable to write training supervision counts");return 0;
        }
        if(action=="training-mask"){
            if(argc!=2)throw std::invalid_argument("Training mask takes no extra arguments");
            const auto encoded=encodedInput();PandoImage image{};
            if(!pando_read_gray_mask(encoded.data(),encoded.size(),&image))throw std::runtime_error(std::string("Training mask: ")+image.error);
            std::unique_ptr<std::uint8_t,decltype(&std::free)> rgba(image.rgba,&std::free);
            std::vector<std::uint8_t> pixels(std::size_t(image.width)*image.height);
            for(std::size_t i=0;i<pixels.size();++i)pixels[i]=rgba.get()[i*4];
            number(image.width);number(image.height);std::cout.write(reinterpret_cast<const char*>(pixels.data()),static_cast<std::streamsize>(pixels.size()));
            if(!std::cout)throw std::runtime_error("Unable to write training mask");return 0;
        }
        if(action=="training-tile"){
            if(argc!=9)throw std::invalid_argument("Expected training tile WIDTH HEIGHT X Y AUGMENT EPOCH INDEX");
            const int width=dimension(argv[2]),height=dimension(argv[3]),x=bounded(argv[4],16384),y=bounded(argv[5],16384);
            const std::string augment=argv[6];if(augment!="0"&&augment!="1")throw std::invalid_argument("Invalid training augmentation flag");
            const auto epoch=index64(argv[7]),index=index64(argv[8]);constexpr std::size_t pixels=512*512;
            if(static_cast<std::int64_t>(width)*height>16777216)throw std::invalid_argument("Image exceeds 16MP budget");
            std::vector<std::uint8_t> input(std::size_t(width)*height*4),target(pixels),known(pixels);
            if(!std::cin.read(reinterpret_cast<char*>(input.data()),static_cast<std::streamsize>(input.size()))||
               !std::cin.read(reinterpret_cast<char*>(target.data()),static_cast<std::streamsize>(target.size()))||
               !std::cin.read(reinterpret_cast<char*>(known.data()),static_cast<std::streamsize>(known.size()))||std::cin.peek()!=std::char_traits<char>::eof())
                throw std::invalid_argument("Training tile input byte length differs");
            const auto output=pando::map_image::trainingTile(input,width,height,x,y,target,known,augment=="1",epoch,index);
            std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
            if(!std::cout)throw std::runtime_error("Unable to write training tile");return 0;
        }
        if(action=="training-scan"){
            if(argc!=6)throw std::invalid_argument("Expected training scan WIDTH HEIGHT EPOCH INDEX");
            const int width=dimension(argv[2]),height=dimension(argv[3]);
            if(static_cast<std::int64_t>(width)*height>16777216)throw std::invalid_argument("Image exceeds 16MP budget");
            const auto epoch=index64(argv[4]),index=index64(argv[5]);
            std::vector<std::uint8_t> input(std::size_t(width)*height*4);
            if(!std::cin.read(reinterpret_cast<char*>(input.data()),static_cast<std::streamsize>(input.size()))||std::cin.peek()!=std::char_traits<char>::eof())
                throw std::invalid_argument("RGBA input byte length differs from dimensions");
            const auto output=pando::map_image::trainingScan(input,width,height,epoch,index);
            std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
            if(!std::cout)throw std::runtime_error("Unable to write training scan");return 0;
        }
        if(action=="header-png"||action=="header-jpeg"||action=="header-webp"){
            if(argc!=2)throw std::invalid_argument("Image header takes no extra arguments");
            const auto encoded=encodedInput();PandoImage image{};
            const bool ok=action=="header-png"?pando_inspect_png(encoded.data(),encoded.size(),&image):
                action=="header-jpeg"?pando_inspect_jpeg(encoded.data(),encoded.size(),&image):pando_inspect_webp(encoded.data(),encoded.size(),&image);
            if(!ok)throw std::runtime_error(std::string("Image header: ")+image.error);
            number(image.width);number(image.height);number(image.orientation);return 0;
        }
        if(action=="prepare-jpeg"||action=="inspect-jpeg"){
            if(argc!=3)throw std::invalid_argument("Expected JPEG preparation with MAX_PIXELS");
            const auto maximum=static_cast<std::uint32_t>(bounded(argv[2],16777216));const auto encoded=encodedInput();
            PandoImage image{};std::uint32_t originalWidth=0,originalHeight=0,boundWidth=0,boundHeight=0;int cmyk=0;
            if(!pando_read_jpeg_draft(encoded.data(),encoded.size(),maximum,action=="inspect-jpeg",&image,&originalWidth,&originalHeight,&boundWidth,&boundHeight,&cmyk))
                throw std::runtime_error(std::string("JPEG preparation: ")+image.error);
            std::unique_ptr<std::uint8_t,decltype(&std::free)> decoded(image.rgba,&std::free);
            number(originalWidth);number(originalHeight);
            if(!decoded){number(originalWidth);number(originalHeight);number(0);return 0;}
            const auto [width,height]=thumbnailSize(static_cast<int>(image.width),static_cast<int>(image.height),static_cast<int>(boundWidth),static_cast<int>(boundHeight));
            const std::vector<std::uint8_t> pixels(decoded.get(),decoded.get()+static_cast<std::size_t>(image.width)*image.height*4);
            const auto resized=cmyk?pando::map_image::resizeCmykThumbnail(pixels,image.width,image.height,width,height):
                pando::map_image::resizeOpaqueThumbnail(pixels,image.width,image.height,width,height);
            std::uint8_t* bytes=nullptr;std::size_t length=0;char error[256]{};
            if(!pando_write_jpeg(resized.data(),width,height,&bytes,&length,error,sizeof(error)))throw std::runtime_error(std::string("JPEG encoding: ")+error);
            std::unique_ptr<std::uint8_t,decltype(&std::free)> output(bytes,&std::free);
            number(width);number(height);number(1);std::cout.write(reinterpret_cast<const char*>(output.get()),static_cast<std::streamsize>(length));
            if(!std::cout)throw std::runtime_error("Unable to write JPEG derivative");return 0;
        }
        if(action=="read-png"||action=="read-jpeg"||action=="read-webp"){
            if(argc!=7)throw std::invalid_argument("Expected image read with MAX_PIXELS X Y WIDTH HEIGHT");
            const int maximum=bounded(argv[2],16777216),x=bounded(argv[3],16384),y=bounded(argv[4],16384),
                width=bounded(argv[5],16384),height=bounded(argv[6],16384);
            const auto encoded=encodedInput();
            const auto image=pando::map_image::readImage(encoded,action.substr(5),maximum,x,y,width,height);
            for(const auto field:{image.encodedWidth,image.encodedHeight,image.orientation,image.originalWidth,image.originalHeight,
                    image.x,image.y,image.rectWidth,image.rectHeight,image.width,image.height})number(static_cast<std::uint32_t>(field));
            std::cout.write(reinterpret_cast<const char*>(image.data.data()),static_cast<std::streamsize>(image.data.size()));
            if(!std::cout)throw std::runtime_error("Unable to write decoded pixels");
            return 0;
        }
        if(((action=="resize-rgba"||action=="resize-bilinear"||action=="thumbnail-pdf")&&argc!=6)||(action=="rotate-rgba"&&argc!=5)||((action=="encode-png"||action=="encode-webp-lossless")&&argc!=4)||
           (action!="resize-rgba"&&action!="resize-bilinear"&&action!="thumbnail-pdf"&&action!="rotate-rgba"&&action!="encode-png"&&action!="encode-webp-lossless"))
            throw std::invalid_argument("Invalid native image operation or arguments");
        const int w=dimension(argv[2]),h=dimension(argv[3]);
        int ow=0,oh=0,degrees=0;
        if(action=="resize-rgba"||action=="resize-bilinear"||action=="thumbnail-pdf"){ow=dimension(argv[4]);oh=dimension(argv[5]);}
        else if(action=="rotate-rgba"){const std::string angle=argv[4];if(angle!="0"&&angle!="90"&&angle!="180"&&angle!="270")throw std::invalid_argument("Invalid clockwise rotation");degrees=std::stoi(angle);}
        if(static_cast<std::int64_t>(w)*h>16777216||((action=="resize-rgba"||action=="resize-bilinear"||action=="thumbnail-pdf")&&static_cast<std::int64_t>(ow)*oh>16777216))throw std::invalid_argument("Image exceeds 16MP budget");
        const auto bytes=static_cast<std::size_t>(w)*h*4;std::vector<std::uint8_t> input(bytes);
        if(!std::cin.read(reinterpret_cast<char*>(input.data()),static_cast<std::streamsize>(bytes))||std::cin.peek()!=std::char_traits<char>::eof())
            throw std::invalid_argument("RGBA input byte length differs from dimensions");
        const auto output=action=="resize-rgba"?pando::map_image::resizeRgba(input,w,h,ow,oh):action=="resize-bilinear"?pando::map_image::resizeOpaqueBilinear(input,w,h,ow,oh):action=="thumbnail-pdf"?pando::map_image::resizeOpaqueThumbnail(input,w,h,ow,oh):
            action=="rotate-rgba"?pando::map_image::rotateRgba(input,w,h,degrees):action=="encode-webp-lossless"?encodeWebpLossless(input,w,h):pando::map_image::encodePngRgba(input,w,h);
        std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
        if(!std::cout)throw std::runtime_error("Unable to write resized pixels");
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
