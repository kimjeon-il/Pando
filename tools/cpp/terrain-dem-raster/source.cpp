#include <gdal.h>
#include <gdal_utils.h>
#include <ogr_srs_api.h>
#include <cpl_conv.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#define NOMINMAX
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

int run(int argc,char** argv){
  try{
#ifdef _WIN32
    _setmode(_fileno(stdin),_O_BINARY);
    _setmode(_fileno(stdout),_O_BINARY);
#endif
    const bool streaming=argc>1&&std::string(argv[1])=="--stream";
    if(streaming?!(argc==5||(argc==6&&std::string(argv[5])=="--strict-etopo")):
      !(argc==8||(argc==9&&std::string(argv[8])=="--strict-etopo")))throw std::invalid_argument("Expected TIFF, level width/height and DEM windows");
    const auto number=[](const char* text){std::size_t at=0;const auto value=std::stoll(text,&at);if(at!=std::string(text).size())throw std::invalid_argument("Invalid DEM window integer");return value;};
    const auto width=number(argv[streaming?3:2]),height=number(argv[streaming?4:3]);
    if(width<1||width>50000||height<1||height>25000)throw std::invalid_argument("DEM level exceeds bounds");
    CPLSetConfigOption("GDAL_PAM_ENABLED","NO");GDALAllRegister();const char* drivers[]={"GTiff",nullptr};
    std::unique_ptr<void,decltype(&GDALClose)> source(GDALOpenEx(argv[streaming?2:1],GDAL_OF_RASTER|GDAL_OF_READONLY,drivers,nullptr,nullptr),GDALClose);
    if(!source||GDALGetRasterCount(source.get())!=1||!GDALGetProjectionRef(source.get())||!*GDALGetProjectionRef(source.get()))
      throw std::invalid_argument("Single-band georeferenced DEM TIFF required");
    double transform[6];const int sw=GDALGetRasterXSize(source.get()),sh=GDALGetRasterYSize(source.get());
    if(sw<1||sh<1||GDALGetGeoTransform(source.get(),transform)!=CE_None||std::abs(transform[0]+180)>1e-8||
      std::abs(transform[1]-360.0/sw)>1e-8||std::abs(transform[2])>1e-8||std::abs(transform[3]-90)>1e-8||
      std::abs(transform[4])>1e-8||std::abs(transform[5]+180.0/sh)>1e-8)throw std::invalid_argument("DEM source grid differs");
    if((streaming&&argc==6)||(!streaming&&argc==9)){
      std::unique_ptr<void,decltype(&OSRDestroySpatialReference)> actual(OSRNewSpatialReference(GDALGetProjectionRef(source.get())),OSRDestroySpatialReference);
      std::unique_ptr<void,decltype(&OSRDestroySpatialReference)> expected(OSRNewSpatialReference(nullptr),OSRDestroySpatialReference);
      const char* registration=GDALGetMetadataItem(source.get(),"AREA_OR_POINT",nullptr);
      if(sw!=43200||sh!=21600||!actual||!expected||OSRImportFromEPSG(expected.get(),9518)!=OGRERR_NONE||!OSRIsSame(actual.get(),expected.get())||
        !registration||std::string(registration)!="Area")throw std::invalid_argument("Expected cell-registered EPSG:9518 ETOPO 30s source");
    }
    int hasNoData=0;const auto noData=GDALGetRasterNoDataValue(GDALGetRasterBand(source.get(),1),&hasNoData);
    if(!hasNoData||!std::isfinite(noData))throw std::invalid_argument("DEM source NoData required");
    std::vector<std::string> arguments={"-of","VRT","-r","average","-te","-180","-90","180","90","-ts",std::to_string(width),std::to_string(height),"-t_srs",GDALGetProjectionRef(source.get())};
    std::vector<char*> pointers;for(auto& value:arguments)pointers.push_back(value.data());pointers.push_back(nullptr);
    std::unique_ptr<GDALWarpAppOptions,decltype(&GDALWarpAppOptionsFree)> options(GDALWarpAppOptionsNew(pointers.data(),nullptr),GDALWarpAppOptionsFree);
    if(!options)throw std::runtime_error("DEM warp configuration failed");
    GDALDatasetH raw=source.get();int usage=0;
    std::unique_ptr<void,decltype(&GDALClose)> vrt(GDALWarp("/vsimem/pando-dem-read.vrt",nullptr,1,&raw,options.get(),&usage),GDALClose);
    if(!vrt||usage)throw std::runtime_error("DEM warped view failed");
    auto band=GDALGetRasterBand(vrt.get(),1);auto mask=GDALGetMaskBand(band);
    const auto readWindow=[&](std::int64_t x0,std::int64_t y0,std::int64_t x1,std::int64_t y1){
    if(x0< -1000000||x0>1000000||x1< -1000000||x1>1000000||y0< -1000000||y0>1000000||y1< -1000000||y1>1000000)
      throw std::invalid_argument("DEM window exceeds bounds");
    const auto outWidth=x1-x0,outHeight=y1-y0;
    if(outWidth<1||outHeight<1||outWidth>5000||outHeight>5000||outWidth*outHeight>16777216||
      x0< -1000000||x1>1000000||y0< -1000000||y1>1000000||y0>=height||y1<=0)
      throw std::invalid_argument("DEM window exceeds bounds");
    const auto startY=std::max<std::int64_t>(0,y0),endY=std::min<std::int64_t>(height,y1),readHeight=endY-startY;
    std::vector<float> output(static_cast<std::size_t>(outWidth*outHeight));
    for(std::int64_t at=0;at<outWidth;){
      const auto sourceX=((x0+at)%width+width)%width,count=std::min(outWidth-at,width-sourceX),pixels=count*readHeight;
      std::vector<float> values(static_cast<std::size_t>(pixels));std::vector<unsigned char> valid(static_cast<std::size_t>(pixels));
      if(GDALRasterIO(band,GF_Read,int(sourceX),int(startY),int(count),int(readHeight),values.data(),int(count),int(readHeight),GDT_Float32,0,0)!=CE_None||
        GDALRasterIO(mask,GF_Read,int(sourceX),int(startY),int(count),int(readHeight),valid.data(),int(count),int(readHeight),GDT_Byte,0,0)!=CE_None)
        throw std::runtime_error("DEM window read failed");
      for(std::int64_t y=0;y<readHeight;y++)for(std::int64_t x=0;x<count;x++){
        const auto index=std::size_t(y*count+x);const float value=values[index];
        if(!valid[index]||value==float(noData))throw std::invalid_argument("DEM NoData in selected window");
        if(!std::isfinite(value)||value< -12000||value>53535)throw std::invalid_argument("DEM elevation outside encoding range");
        output[std::size_t((y+startY-y0)*outWidth+at+x)]=value;
      }
      at+=count;
    }
    for(std::int64_t y=0;y<startY-y0;y++)std::copy_n(output.data()+(startY-y0)*outWidth,outWidth,output.data()+y*outWidth);
    for(std::int64_t y=endY-y0;y<outHeight;y++)std::copy_n(output.data()+(endY-y0-1)*outWidth,outWidth,output.data()+y*outWidth);
    std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()*sizeof(float)));
    std::cout.flush();if(!std::cout)throw std::runtime_error("DEM output write failed");
    };
    if(streaming){
      for(;;){std::array<unsigned char,24> header{};std::cin.read(reinterpret_cast<char*>(header.data()),header.size());const auto count=std::cin.gcount();
        if(count==0&&std::cin.eof())break;if(count!=24||std::memcmp(header.data(),"PDEMWIN1",8)!=0)throw std::invalid_argument("Invalid DEM stream header");
        const auto field=[&](int at){const auto n=std::uint32_t(header[at])|(std::uint32_t(header[at+1])<<8)|(std::uint32_t(header[at+2])<<16)|(std::uint32_t(header[at+3])<<24);return std::int64_t(static_cast<std::int32_t>(n));};
        readWindow(field(8),field(12),field(16),field(20));
      }
    }else readWindow(number(argv[4]),number(argv[5]),number(argv[6]),number(argv[7]));
    vrt.reset();VSIUnlink("/vsimem/pando-dem-read.vrt");return 0;
  }catch(const std::exception& error){std::cerr<<"terrain-dem-raster: "<<error.what()<<'\n';return 1;}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
  try{std::vector<std::string> args;args.reserve(argc);for(int i=0;i<argc;i++){
    const int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,argv[i],-1,nullptr,0,nullptr,nullptr);
    if(size<=0)throw std::invalid_argument("Invalid Unicode argument");std::vector<char> text(static_cast<std::size_t>(size));
    if(WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,argv[i],-1,text.data(),size,nullptr,nullptr)!=size)throw std::invalid_argument("Invalid Unicode argument");
    args.emplace_back(text.data());}std::vector<char*> ptr;for(auto& value:args)ptr.push_back(value.data());return run(argc,ptr.data());
  }catch(const std::exception& error){std::cerr<<"terrain-dem-raster: "<<error.what()<<'\n';return 1;}}
#else
int main(int argc,char** argv){return run(argc,argv);}
#endif
