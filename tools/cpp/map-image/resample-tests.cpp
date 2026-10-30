#include "resample.h"
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void check(bool condition,const std::string& message){if(!condition)throw std::runtime_error(message);}
template<class F> void rejects(F operation){try{operation();}catch(const std::invalid_argument&){return;}throw std::runtime_error("Invalid image was accepted");}
}
int main(int argc,char** argv){
    try{
        check(argc==2,"Expected oracle fixture directory");
        std::vector<std::uint8_t> input;
        for(int y=0;y<5;++y)for(int x=0;x<7;++x)for(int c=0;c<3;++c)input.push_back(static_cast<std::uint8_t>((x*37+y*19+c*73+x*y*11)%256));
        for(const auto size:std::vector<std::pair<int,int>>{{3,2},{11,8},{7,2},{3,5},{1,1},{130,4}}){
            const auto name=std::string(argv[1])+"/rgb-7x5-to-"+std::to_string(size.first)+"x"+std::to_string(size.second)+".raw";
            std::ifstream file(name,std::ios::binary);check(file.good(),"Missing oracle: "+name);
            const std::vector<std::uint8_t> expected((std::istreambuf_iterator<char>(file)),std::istreambuf_iterator<char>());
            const auto actual=pando::map_image::resizeRgb(input,7,5,size.first,size.second);
            check(actual==expected,"Resampled RGB pixels differ from Pillow 12.3.0: "+name);
        }
        check(pando::map_image::resizeRgb(input,7,5,7,5)==input,"Identity resize changed RGB pixels");
        std::vector<std::uint8_t> rgba;
        const int alpha[]{0,1,2,127,254,255};
        for(int y=0;y<5;++y)for(int x=0;x<7;++x)for(int c=0;c<4;++c)
            rgba.push_back(static_cast<std::uint8_t>(c<3?(x*37+y*19+c*73+x*y*11)%256:alpha[(x+y*7)%6]));
        for(const auto size:std::vector<std::pair<int,int>>{{3,2},{11,8},{7,2},{3,5},{1,1},{130,4}}){
            const auto name=std::string(argv[1])+"/rgba-7x5-to-"+std::to_string(size.first)+"x"+std::to_string(size.second)+".raw";
            std::ifstream file(name,std::ios::binary);check(file.good(),"Missing oracle: "+name);
            const std::vector<std::uint8_t> expected((std::istreambuf_iterator<char>(file)),std::istreambuf_iterator<char>());
            check(pando::map_image::resizeRgba(rgba,7,5,size.first,size.second)==expected,"Resampled RGBA pixels differ from Pillow 12.3.0: "+name);
        }
        check(pando::map_image::resizeRgba(rgba,7,5,7,5)==rgba,"Identity resize changed RGBA pixels");
        rejects([&]{pando::map_image::resizeRgba(rgba,7,4,3,2);});
        rejects([&]{pando::map_image::resizeRgb(input,7,5,0,1);});
        rejects([&]{pando::map_image::resizeRgb(input,7,5,20000,1);});
        rejects([&]{pando::map_image::resizeRgb(input,7,4,3,2);});
        const auto streamed=pando::map_image::resizeOpaqueBilinearRows(4097,4097,2,2,
            [](int y,std::uint8_t* row,std::size_t length){
                (void)y;
                for(std::size_t i=0;i<length;i+=4){row[i]=17;row[i+1]=92;row[i+2]=203;row[i+3]=255;}
            });
        check(streamed==std::vector<std::uint8_t>({17,92,203,255,17,92,203,255,17,92,203,255,17,92,203,255}),
              "Streaming large training overview changed constant pixels");
        rejects([&]{pando::map_image::resizeOpaqueBilinearRows(2,2,1,1,
            [](int,std::uint8_t* row,std::size_t length){for(std::size_t i=0;i<length;i++)row[i]=0;});});
        std::cout<<"RGB and RGBA resampling match Pillow pixel oracles\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
