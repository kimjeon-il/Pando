#include "resample.h"
#include "png.h"
#include <cstdint>
#include <iostream>
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
}
int main(int argc,char** argv){
    try{
#ifdef _WIN32
        if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Unable to set binary I/O");
#endif
        if(argc<2)throw std::invalid_argument("Expected resize-rgba, rotate-rgba or encode-png");
        const std::string action=argv[1];
        if((action=="resize-rgba"&&argc!=6)||(action=="rotate-rgba"&&argc!=5)||(action=="encode-png"&&argc!=4)||
           (action!="resize-rgba"&&action!="rotate-rgba"&&action!="encode-png"))
            throw std::invalid_argument("Invalid native image operation or arguments");
        const int w=dimension(argv[2]),h=dimension(argv[3]);
        int ow=0,oh=0,degrees=0;
        if(action=="resize-rgba"){ow=dimension(argv[4]);oh=dimension(argv[5]);}
        else if(action=="rotate-rgba"){const std::string angle=argv[4];if(angle!="0"&&angle!="90"&&angle!="180"&&angle!="270")throw std::invalid_argument("Invalid clockwise rotation");degrees=std::stoi(angle);}
        if(static_cast<std::int64_t>(w)*h>16777216||(action=="resize-rgba"&&static_cast<std::int64_t>(ow)*oh>16777216))throw std::invalid_argument("Image exceeds 16MP budget");
        const auto bytes=static_cast<std::size_t>(w)*h*4;std::vector<std::uint8_t> input(bytes);
        if(!std::cin.read(reinterpret_cast<char*>(input.data()),static_cast<std::streamsize>(bytes))||std::cin.peek()!=std::char_traits<char>::eof())
            throw std::invalid_argument("RGBA input byte length differs from dimensions");
        const auto output=action=="resize-rgba"?pando::map_image::resizeRgba(input,w,h,ow,oh):
            action=="rotate-rgba"?pando::map_image::rotateRgba(input,w,h,degrees):pando::map_image::encodePngRgba(input,w,h);
        std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
        if(!std::cout)throw std::runtime_error("Unable to write resized pixels");
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
