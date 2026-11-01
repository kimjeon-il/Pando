// Build masked, area-averaged RGB tint samples using native GDAL.
#include <gdal.h>
#include <gdal_alg.h>
#include <ogr_api.h>
#include <ogr_srs_api.h>
#include <cpl_conv.h>
#include <cpl_string.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
using Byte=std::uint8_t;
using Dataset=std::unique_ptr<void,decltype(&GDALClose)>;
using Geometry=std::unique_ptr<void,decltype(&OGR_G_DestroyGeometry)>;
void check(CPLErr e,const char* message){if(e!=CE_None)throw std::runtime_error(message);}
int integer(const char* input,int limit){std::size_t n=0;const auto value=std::stoll(input,&n);
  if(n!=std::string(input).size()||value<1||value>limit)throw std::invalid_argument("Tint dimensions exceed bounds");return int(value);}
std::vector<Geometry> geometries(const char* path){
  Dataset data(GDALOpenEx(path,GDAL_OF_VECTOR|GDAL_OF_READONLY,nullptr,nullptr,nullptr),GDALClose);
  if(!data||GDALDatasetGetLayerCount(data.get())!=1)throw std::invalid_argument("Expected one GeoJSON geometry layer");
  auto layer=GDALDatasetGetLayer(data.get(),0);std::vector<Geometry> result;
  while(auto feature=OGR_L_GetNextFeature(layer)){
    auto geometry=OGR_F_GetGeometryRef(feature);const auto type=geometry?wkbFlatten(OGR_G_GetGeometryType(geometry)):wkbUnknown;
    if(type!=wkbPolygon&&type!=wkbMultiPolygon){OGR_F_Destroy(feature);throw std::invalid_argument("Tint requires polygon geometries");}
    result.emplace_back(OGR_G_Clone(geometry),OGR_G_DestroyGeometry);OGR_F_Destroy(feature);
    if(result.size()>1000000)throw std::invalid_argument("Tint geometry count exceeds bounds");
  }
  if(result.empty())throw std::invalid_argument("Tint polygon layer is empty");return result;
}
std::vector<Byte> rasterize(const std::vector<Geometry>& shapes,int width,int height,const double* original,int start,bool touched){
  auto driver=GDALGetDriverByName("MEM");Dataset raster(GDALCreate(driver,"",width,height,1,GDT_Byte,nullptr),GDALClose);
  if(!raster)throw std::runtime_error("Cannot create tint mask");double transform[6];std::copy_n(original,6,transform);
  transform[3]+=start*original[5];check(GDALSetGeoTransform(raster.get(),transform),"Cannot set tint mask grid");
  const double north=transform[3],south=north+height*transform[5];std::vector<OGRGeometryH> selected;
  for(const auto& geometry:shapes){OGREnvelope extent;OGR_G_GetEnvelope(geometry.get(),&extent);if(extent.MinY<=north&&extent.MaxY>=south)selected.push_back(geometry.get());}
  if(!selected.empty()){
    std::vector<double> burns(selected.size(),1);int band=1;char** options=nullptr;if(touched)options=CSLSetNameValue(options,"ALL_TOUCHED","TRUE");
    auto error=GDALRasterizeGeometries(raster.get(),1,&band,int(selected.size()),selected.data(),nullptr,nullptr,burns.data(),options,nullptr,nullptr);
    CSLDestroy(options);check(error,"Cannot rasterize tint geometry");
  }
  std::vector<Byte> result(std::size_t(width)*height);check(GDALRasterIO(GDALGetRasterBand(raster.get(),1),GF_Read,0,0,width,height,result.data(),width,height,GDT_Byte,0,0),"Cannot read tint mask");return result;
}
int main(int argc,char** argv){try{
#ifdef _WIN32
  if(_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set binary mode");
#endif
  if(argc!=7)throw std::invalid_argument("Expected source, ice, land, new temporary TIFF, width and height");
  const int width=integer(argv[5],30000),height=integer(argv[6],16384);
  if(std::uint64_t(width)*height>12000000||std::filesystem::exists(argv[4]))throw std::invalid_argument("Tint output exceeds bounds or temporary TIFF exists");
  CPLSetConfigOption("GDAL_PAM_ENABLED","NO");CPLSetConfigOption("GDAL_TIFF_INTERNAL_MASK","YES");CPLSetConfigOption("GDAL_CACHEMAX","64");GDALAllRegister();
  const char* drivers[]={"GTiff",nullptr};Dataset source(GDALOpenEx(argv[1],GDAL_OF_RASTER|GDAL_OF_READONLY,drivers,nullptr,nullptr),GDALClose);
  if(!source||GDALGetRasterCount(source.get())<3)throw std::invalid_argument("Three-band tint TIFF required");
  const int sw=GDALGetRasterXSize(source.get()),sh=GDALGetRasterYSize(source.get());double transform[6];
  if(sw<width||sh<height||sw>100000||sh>100000||GDALGetGeoTransform(source.get(),transform)!=CE_None||
    std::abs(transform[0]+180)>1e-7||std::abs(transform[1]-360.0/sw)>1e-7||std::abs(transform[2])>1e-7||
    std::abs(transform[3]-90)>1e-7||std::abs(transform[4])>1e-7||std::abs(transform[5]+180.0/sh)>1e-7)
    throw std::invalid_argument("Tint source grid is not global EPSG:4326");
  std::unique_ptr<void,decltype(&OSRDestroySpatialReference)> actual(OSRNewSpatialReference(GDALGetProjectionRef(source.get())),OSRDestroySpatialReference),
    expected(OSRNewSpatialReference(nullptr),OSRDestroySpatialReference);
  if(!actual||!expected||OSRImportFromEPSG(expected.get(),4326)!=OGRERR_NONE||!OSRIsSame(actual.get(),expected.get()))throw std::invalid_argument("Tint source grid is not global EPSG:4326");
  const auto ice=geometries(argv[2]),land=geometries(argv[3]);
  char** options=nullptr;options=CSLSetNameValue(options,"TILED","YES");options=CSLSetNameValue(options,"COMPRESS","DEFLATE");
  Dataset masked(GDALCreate(GDALGetDriverByName("GTiff"),argv[4],sw,sh,3,GDT_Byte,options),GDALClose);CSLDestroy(options);
  if(!masked)throw std::runtime_error("Cannot create masked tint TIFF");
  check(GDALSetGeoTransform(masked.get(),transform),"Cannot set masked tint transform");check(GDALSetProjection(masked.get(),GDALGetProjectionRef(source.get())),"Cannot set masked tint CRS");
  check(GDALCreateDatasetMaskBand(masked.get(),GMF_PER_DATASET),"Cannot create masked tint mask");auto mask=GDALGetMaskBand(GDALGetRasterBand(masked.get(),1));
  for(int y=0;y<sh;y+=128){const int rows=std::min(128,sh-y),start=std::max(0,y-1),end=std::min(sh,y+rows+1),maskRows=end-start;
    const auto iceMask=rasterize(ice,sw,rows,transform,y,true),landMask=rasterize(land,sw,maskRows,transform,start,false);
    std::vector<Byte> rgb(std::size_t(sw)*rows*3),valid(std::size_t(sw)*rows);
    for(int c=0;c<3;c++)check(GDALRasterIO(GDALGetRasterBand(source.get(),c+1),GF_Read,0,y,sw,rows,rgb.data()+std::size_t(c)*sw*rows,sw,rows,GDT_Byte,0,0),"Cannot read tint colors");
    for(int row=0;row<rows;row++)for(int x=0;x<sw;x++){const auto index=std::size_t(row)*sw+x;const int yy=y+row-start;
      const bool onLand=landMask[std::size_t(yy)*sw+x]!=0;bool interior=onLand;
      for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)interior=interior&&landMask[std::size_t(std::clamp(yy+dy,0,maskRows-1))*sw+(x+dx+sw)%sw];
      const auto r=rgb[index],g=rgb[std::size_t(sw)*rows+index],b=rgb[std::size_t(sw)*rows*2+index];
      const bool nearWhite=std::min({r,g,b})>=230,white=r==255&&g==255&&b==255;
      valid[index]=Byte((iceMask[index]||(onLand&&!white&&(!nearWhite||interior)))?255:0);
    }
    for(int c=0;c<3;c++)check(GDALRasterIO(GDALGetRasterBand(masked.get(),c+1),GF_Write,0,y,sw,rows,rgb.data()+std::size_t(c)*sw*rows,sw,rows,GDT_Byte,0,0),"Cannot write masked tint colors");
    check(GDALRasterIO(mask,GF_Write,0,y,sw,rows,valid.data(),sw,rows,GDT_Byte,0,0),"Cannot write tint donor mask");
  }
  masked.reset();masked.reset(GDALOpenEx(argv[4],GDAL_OF_RASTER|GDAL_OF_READONLY,drivers,nullptr,nullptr));
  if(!masked)throw std::runtime_error("Cannot reopen masked tint TIFF");const std::size_t pixels=std::size_t(width)*height;
  GDALRasterIOExtraArg extra;INIT_RASTERIO_EXTRA_ARG(extra);extra.eResampleAlg=GRIORA_Average;
  std::vector<float> rgb(pixels*3);std::vector<Byte> valid(pixels);
  for(int c=0;c<3;c++)check(GDALRasterIOEx(GDALGetRasterBand(masked.get(),c+1),GF_Read,0,0,sw,sh,rgb.data()+pixels*c,width,height,GDT_Float32,0,0,&extra),"Cannot average tint colors");
  check(GDALRasterIOEx(GDALGetMaskBand(GDALGetRasterBand(masked.get(),1)),GF_Read,0,0,sw,sh,valid.data(),width,height,GDT_Byte,0,0,&extra),"Cannot average tint mask");
  std::cout.write("PDTINT02",8);std::uint32_t dimensions[]={std::uint32_t(width),std::uint32_t(height)};std::cout.write(reinterpret_cast<char*>(dimensions),8);
  std::cout.write(reinterpret_cast<char*>(rgb.data()),static_cast<std::streamsize>(rgb.size()*4));std::cout.write(reinterpret_cast<char*>(valid.data()),static_cast<std::streamsize>(valid.size()));
  if(!std::cout)throw std::runtime_error("Cannot write tint samples");return 0;
}catch(const std::exception& error){std::cerr<<"terrain-dem-tint: "<<error.what()<<'\n';return 1;}}
