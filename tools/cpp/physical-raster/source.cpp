#include <gdal.h>
#include <cpl_conv.h>
#include <cstdint>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

int run(int argc,char** argv){
  try{
#ifdef _WIN32
    _setmode(_fileno(stdout),_O_BINARY);
#endif
    if(argc!=3||(std::string(argv[1])!="inspect"&&std::string(argv[1])!="read-rgb"))
      throw std::invalid_argument("Expected inspect or read-rgb and a TIFF path");
    CPLSetConfigOption("GDAL_PAM_ENABLED","NO");
    GDALAllRegister();const char* drivers[]={"GTiff",nullptr};
    std::unique_ptr<void,decltype(&GDALClose)> source(GDALOpenEx(argv[2],GDAL_OF_RASTER|GDAL_OF_READONLY,drivers,nullptr,nullptr),GDALClose);
    if(!source)throw std::runtime_error("Unable to open physical TIFF");
    const int width=GDALGetRasterXSize(source.get()),height=GDALGetRasterYSize(source.get()),bands=GDALGetRasterCount(source.get());
    if(width<1||height<1||width>30000||height>16384||std::uint64_t(width)*height>240000000||(bands!=1&&bands!=3))
      throw std::invalid_argument("Unsupported physical raster dimensions or channels");
    for(int i=1;i<=bands;i++){
      const auto band=GDALGetRasterBand(source.get(),i);
      const auto expected=bands==1?GCI_GrayIndex:(i==1?GCI_RedBand:i==2?GCI_GreenBand:GCI_BlueBand);
      if(!band||GDALGetRasterDataType(band)!=GDT_Byte||GDALGetRasterColorInterpretation(band)!=expected)
        throw std::invalid_argument("Physical TIFF must be byte RGB or grayscale");
    }
    if(std::string(argv[1])=="inspect"){
      std::cout<<"{\"width\":"<<width<<",\"height\":"<<height<<",\"mode\":\""<<(bands==1?"L":"RGB")<<"\"}\n";
      return 0;
    }
    std::vector<unsigned char> rgb(std::size_t(width)*3),gray(bands==1?width:0);int indices[]={1,2,3};
    for(int y=0;y<height;y++){
      if(bands==1){
        if(GDALRasterIO(GDALGetRasterBand(source.get(),1),GF_Read,0,y,width,1,gray.data(),width,1,GDT_Byte,0,0)!=CE_None)
          throw std::runtime_error("Physical grayscale source read failed");
        for(int x=0;x<width;x++)rgb[std::size_t(x)*3]=rgb[std::size_t(x)*3+1]=rgb[std::size_t(x)*3+2]=gray[x];
      }else if(GDALDatasetRasterIO(source.get(),GF_Read,0,y,width,1,rgb.data(),width,1,GDT_Byte,3,indices,3,width*3,1)!=CE_None)
        throw std::runtime_error("Physical RGB source read failed");
      std::cout.write(reinterpret_cast<const char*>(rgb.data()),static_cast<std::streamsize>(rgb.size()));
      if(!std::cout)throw std::runtime_error("Physical source output failed");
    }
    return 0;
  }catch(const std::exception& error){std::cerr<<"physical-raster: "<<error.what()<<'\n';return 1;}
}

#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
  try{
    std::vector<std::string> arguments;arguments.reserve(argc);
    for(int i=0;i<argc;i++){
      const int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,argv[i],-1,nullptr,0,nullptr,nullptr);
      if(size<=0)throw std::invalid_argument("Invalid Unicode argument");
      std::vector<char> value(static_cast<std::size_t>(size));
      if(WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,argv[i],-1,value.data(),size,nullptr,nullptr)!=size)
        throw std::invalid_argument("Cannot encode Unicode argument");
      arguments.emplace_back(value.data());
    }
    std::vector<char*> pointers;for(auto& value:arguments)pointers.push_back(value.data());
    return run(argc,pointers.data());
  }catch(const std::exception& error){std::cerr<<"physical-raster: "<<error.what()<<'\n';return 1;}
}
#else
int main(int argc,char** argv){return run(argc,argv);}
#endif
