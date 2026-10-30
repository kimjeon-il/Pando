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
        const auto streamed=pando::map_image::resizeOpaqueBilinearRows(4097,4097,4,3,
            [](int y,std::uint8_t* row,std::size_t length){
                for(std::size_t i=0;i<length;i+=4){const auto x=i/4;
                    row[i]=static_cast<std::uint8_t>(x/32);row[i+1]=static_cast<std::uint8_t>(y/32);
                    row[i+2]=static_cast<std::uint8_t>(x/64+y/64);row[i+3]=255;}
            });
        check(streamed==std::vector<std::uint8_t>({19,25,21,255,48,25,36,255,80,25,52,255,108,25,66,255,
              19,64,41,255,48,64,56,255,80,64,72,255,108,64,86,255,
              19,102,60,255,48,102,75,255,80,102,91,255,108,102,105,255}),
              "Streaming large training overview differs from Pillow 12.3");
        rejects([&]{pando::map_image::resizeOpaqueBilinearRows(2,2,1,1,
            [](int,std::uint8_t* row,std::size_t length){for(std::size_t i=0;i<length;i++)row[i]=0;});});
        const std::vector<std::uint8_t> orientedRows={10,20,30,255,50,60,70,255,90,100,110,255,
            20,30,40,255,60,70,80,255,100,110,120,255};
        pando::map_image::OpaqueBilinearAccumulator accumulator(3,2,2,2);
        accumulator.addRow(1,orientedRows.data()+12,12);
        rejects([&]{accumulator.addRow(1,orientedRows.data()+12,12);});
        accumulator.addRow(0,orientedRows.data(),12);
        check(accumulator.finish()==std::vector<std::uint8_t>({25,35,45,255,75,85,95,255,35,45,55,255,85,95,105,255}),
              "Out-of-order source rows differ from Pillow");
        pando::map_image::OpaqueBilinearAccumulator incomplete(3,2,2,2);
        rejects([&]{incomplete.finish();});
        pando::map_image::OpaqueBilinearColumnAccumulator columns(3,2,2,2);
        const std::vector<std::uint8_t> col0={10,20,30,255,20,30,40,255},col1={50,60,70,255,60,70,80,255},
            col2={90,100,110,255,100,110,120,255};
        columns.addColumn(2,col2.data(),col2.size());columns.addColumn(0,col0.data(),col0.size());
        rejects([&]{columns.addColumn(2,col2.data(),col2.size());});
        columns.addColumn(1,col1.data(),col1.size());
        check(columns.finish()==std::vector<std::uint8_t>({25,35,45,255,75,85,95,255,35,45,55,255,85,95,105,255}),
              "Column-streamed source differs from Pillow");
        std::cout<<"RGB and RGBA resampling match Pillow pixel oracles\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
