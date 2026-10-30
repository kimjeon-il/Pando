#include "resample.h"
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
        if(argc!=6||std::string(argv[1])!="resize-rgba")throw std::invalid_argument("Expected resize-rgba WIDTH HEIGHT OUTPUT_WIDTH OUTPUT_HEIGHT");
        const int w=dimension(argv[2]),h=dimension(argv[3]),ow=dimension(argv[4]),oh=dimension(argv[5]);
        if(static_cast<std::int64_t>(w)*h>16777216||static_cast<std::int64_t>(ow)*oh>16777216)throw std::invalid_argument("Image exceeds 16MP budget");
        const auto bytes=static_cast<std::size_t>(w)*h*4;std::vector<std::uint8_t> input(bytes);
        if(!std::cin.read(reinterpret_cast<char*>(input.data()),static_cast<std::streamsize>(bytes))||std::cin.peek()!=std::char_traits<char>::eof())
            throw std::invalid_argument("RGBA input byte length differs from dimensions");
        const auto output=pando::map_image::resizeRgba(input,w,h,ow,oh);
        std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
        if(!std::cout)throw std::runtime_error("Unable to write resized pixels");
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
