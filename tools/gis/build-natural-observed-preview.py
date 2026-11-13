#!/usr/bin/env python3
"""Build a bounded, reproducible natural-color candidate, never a global release.

WorldCover is sampled only inside explicit 3-degree review windows. RGI7 and
fixed-date observed polar masks are rasterized to the existing DEM tile grid.
Failed or inaccessible sources stop the build; no fabricated masks substitute.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import math
import shutil
import urllib.parse
import urllib.request
from pathlib import Path

VERSION='0.1.0-preview.2'
BASE_REV='c3d761ffc6d3cd54300e6fb491901551d8de3b54'
BASE_ROOT=f'https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/{BASE_REV}/terrain/natural/v0.1.0-preview.1/'
WC_ROOT='https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/'
RGI_URL='https://ihp-wins.unesco.org/dataset/33a5017a-e6e9-43cc-82d6-62da7fbb74d8/resource/070f3115-9792-4173-926c-600af1cf97f6/download/rgi2000-v7.0-g-15_south_asia_east.zip'
POLAR={
 'greenland':('GreenlandIceMask_2018.00_2025.0_100m_v3.tif','ef60dc511dec9702ba12dbf2ca4ed56b',
    'GreenlandIceMask_2018.00_2025.0_v3_time_stamps.txt'),
 'antarctica':('AntarcticIceMask_2018.00_2024.75_240m_v3.tif','ff5e3a7cb5fe49d202907d53a621e976',
    'AntarcticIceMask_2018.00_2024.75_v3_time_stamps.txt'),
}
REGIONS=[('china-southwest',106,30),('thailand',100,16),('himalaya',86,28),('sahara',15,25),
 ('amazon',-62,-4),('greenland',-44,76),('antarctica',25,-82),('netherlands-coast-review',5,52),('australia-arid',134,-25)]


def digest(data):return hashlib.sha256(data).hexdigest()


def download(url,path,limit,expected_sha=None,expected_md5=None):
    path=Path(path)
    if path.exists():
        data=path.read_bytes()
        if expected_sha and digest(data)!=expected_sha:raise ValueError('Cached source SHA mismatch')
        if expected_md5 and hashlib.md5(data).hexdigest()!=expected_md5:raise ValueError('Cached source MD5 mismatch')
        return data,{'url':url,'bytes':len(data),'sha256':digest(data),'cached':True}
    request=urllib.request.Request(url,headers={'User-Agent':'PandoLab natural terrain research/1.0'})
    with urllib.request.urlopen(request,timeout=90) as response:
        actual=response.url
        if 'urs.earthdata.nasa.gov' in actual:raise RuntimeError('Earthdata authentication required; no credentials supplied')
        size=response.headers.get('Content-Length')
        if size and int(size)>limit:raise ValueError('Source exceeds bounded acquisition limit')
        pieces=[];total=0
        while True:
            part=response.read(1024*1024)
            if not part:break
            total+=len(part)
            if total>limit:raise ValueError('Acquisition byte budget exceeded')
            pieces.append(part)
        data=b''.join(pieces)
        record={'url':url,'resolvedUrl':actual.split('?')[0],'bytes':len(data),'sha256':digest(data),
            'etag':response.headers.get('ETag'),'lastModified':response.headers.get('Last-Modified')}
    if expected_sha and digest(data)!=expected_sha:raise ValueError('Source SHA mismatch: '+url)
    if expected_md5 and hashlib.md5(data).hexdigest()!=expected_md5:raise ValueError('Published source MD5 mismatch: '+url)
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as stream:stream.write(data)
    return data,record


def probe(output):
    """Bounded metadata only. Saves failures instead of concealing auth/network limits."""
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    urls={
      'worldcover':WC_ROOT+'ESA_WorldCover_10m_2021_v200_N27E084_Map.tif',
      'rgi7-public-mirror':RGI_URL,
      'polar-record':'https://zenodo.org/api/records/15327619',
    }
    result={}
    for name,url in urls.items():
        try:
            req=urllib.request.Request(url,headers={'Range':'bytes=0-16383','User-Agent':'PandoLab terrain source check'})
            with urllib.request.urlopen(req,timeout=45) as response:
                data=response.read(16384)
                row={'status':response.status,'resolvedUrl':response.url.split('?')[0],
                    'type':response.headers.get('Content-Type'),'contentRange':response.headers.get('Content-Range'),
                    'contentLength':response.headers.get('Content-Length'),'prefixBytes':len(data)}
                if name=='polar-record':
                    metadata=json.loads(data)
                    row['license']=metadata.get('metadata',{}).get('license')
                    row['files']=[{'key':f['key'],'size':f['size'],'checksum':f['checksum']} for f in metadata.get('files',[])]
                result[name]=row
        except Exception as error:result[name]={'error':str(error),'url':url}
    (output/'source-probe.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


def worldcover_grid(region,longitude,latitude,shape,transform,cache,receipts):
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject
    from rasterio.windows import from_bounds as window_from_bounds
    result=np.zeros(shape,dtype=np.uint8)
    if region in POLAR:return result
    west,east=longitude-1.5,longitude+1.5
    south,north=latitude-1.5,latitude+1.5
    for lat in range(3*math.floor(south/3),3*math.ceil(north/3),3):
        for lon in range(3*math.floor(west/3),3*math.ceil(east/3),3):
            name=f'ESA_WorldCover_10m_2021_v200_{"N" if lat>=0 else "S"}{abs(lat):02d}{"E" if lon>=0 else "W"}{abs(lon):03d}_Map.tif'
            url=WC_ROOT+name
            w,s,e,n=max(west,lon),max(south,lat),min(east,lon+3),min(north,lat+3)
            if w>=e or s>=n:continue
            width=max(1,math.ceil((e-w)*60));height=max(1,math.ceil((n-s)*60))
            with rasterio.open('/vsicurl/'+url) as src:
                if src.crs.to_epsg()!=4326:raise ValueError('WorldCover source CRS changed')
                array=src.read(1,window=window_from_bounds(w,s,e,n,src.transform),
                    out_shape=(height,width),resampling=Resampling.mode)
                if not set(np.unique(array)).issubset({0,10,20,30,40,50,60,70,80,90,95,100}):
                    raise ValueError('Unexpected WorldCover category (not numeric interpolation)')
                data=io.BytesIO();np.save(data,array,allow_pickle=False);payload=data.getvalue()
                filename=f'wc-{region}-{lat}-{lon}.npy';(cache/filename).write_bytes(payload)
                row={'id':name,'url':url,'observation':'2021','license':'CC BY 4.0',
                    'sha256':digest(payload),'hashScope':'exact downsampled review-window array, not the entire source COG',
                    'retainedInput':filename,'window':[w,s,e,n],'sourceSize':[src.width,src.height],
                    'resampling':'categorical mode to review resolution, nearest into target grid'}
                receipts.append(row)
                part=np.zeros(shape,dtype=np.uint8)
                reproject(array,part,src_transform=from_bounds(w,s,e,n,width,height),src_crs='EPSG:4326',
                    dst_transform=transform,dst_crs='EPSG:4326',src_nodata=0,dst_nodata=0,resampling=Resampling.nearest)
                result[part!=0]=part[part!=0]
    if not np.any(result):raise ValueError('WorldCover review window produced no observed classes: '+region)
    return result


def glacier_grid(archive,shape,transform):
    import numpy as np
    import fiona
    from affine import Affine
    from rasterio.features import rasterize
    from rasterio.transform import array_bounds
    from rasterio.warp import transform_geom
    bounds=array_bounds(*shape,transform)
    layers=fiona.listlayers('zip://'+str(archive))
    layer=next((name for name in layers if '15_south_asia_east' in name.lower()),None)
    if layer is None:raise ValueError('RGI7 region-15 shapefile is absent')
    geometries=[]
    with fiona.open('zip://'+str(archive),layer=layer) as collection:
        for feature in collection.filter(bbox=bounds):
            properties=dict(feature['properties'])
            if not str(properties.get('rgi_id','')).startswith('RGI2000-v7.0-G-15-'):
                raise ValueError('Unrecognized RGI7 glacier identity')
            geometries.append(transform_geom(collection.crs,'EPSG:4326',feature['geometry']))
    if not geometries:raise ValueError('No observed RGI7 mountain glaciers found in the sample')
    height,width=shape
    high=rasterize(((geometry,1) for geometry in geometries),out_shape=(height*4,width*4),
        transform=transform*Affine.scale(0.25,0.25),fill=0,dtype='uint8')
    return high.reshape(height,4,width,4).mean(axis=(1,3)).astype('float32'),len(geometries)


def check_polar_coverage_bounds(minimum,maximum,finite):
    # Permit float32 average-resampling roundoff only, never nodata or invalid classes.
    epsilon=1e-6
    if not finite or not math.isfinite(minimum) or not math.isfinite(maximum) or minimum < -epsilon or maximum > 1+epsilon:
        raise ValueError(f'Invalid reprojected polar coverage: min={minimum!r}, max={maximum!r}, finite={finite!r}')
    return {'rawMinimum':minimum,'rawMaximum':maximum,'roundoffTolerance':epsilon}


def repair_polar_outside_latitude_gutter(result,transform):
    """Copy only the 1-pixel texture gutters beyond +/-90 deg latitude.

    Latitude outside the legal Earth domain has no observed ice coverage.
    This is edge replication for texture sampling, not an interior NoData fill.
    Any interior NaN remains a hard source-data failure.
    """
    import numpy as np
    if result.shape[0]<2:raise ValueError('Polar texture requires an interior row')
    repaired=0
    for row,near in ((0,1),(result.shape[0]-1,result.shape[0]-2)):
        center_lat=transform.f+(row+0.5)*transform.e
        if center_lat > 90.0+1e-8 or center_lat < -90.0-1e-8:
            near_lat=transform.f+(near+0.5)*transform.e
            if not (-90.0<=near_lat<=90.0) or not bool(np.isfinite(result[near]).all()):
                raise ValueError('Polar edge gutter has no valid adjacent observed interior')
            repaired+=int(np.count_nonzero(~np.isfinite(result[row])))
            result[row]=result[near]
    return repaired


def polar_grid(path,times,shape,transform):
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    import re
    rows=[float(value) for value in re.findall(r'20\d\d\.\d+',times)]
    with rasterio.open(path) as src:
        if len(rows)!=src.count:raise ValueError('Polar band timestamps do not match raster bands')
        index=min(range(len(rows)),key=lambda i:abs(rows[i]-2021.0))
        if abs(rows[index]-2021.0)>0.26:raise ValueError('No observed polar mask at the chosen fixed 2021 reference')
        small=src.read(index+1,out_shape=(128,128),resampling=Resampling.nearest,masked=True)
        sampled=small.compressed()
        # When a floating mask has no declared NoData, IEEE NaN explicitly
        # denotes absent observation. This is NOT ice=0 classification.
        if src.nodata is None and src.dtypes[index].startswith('float'):
            sampled=sampled[~np.isnan(sampled)]
        values=set(np.unique(sampled).tolist())
        if not values.issubset({0,1}):raise ValueError('Polar source is not a binary ice mask: '+str(values))
        # Floating source masks can contain IEEE NaN outside the observed
        # footprint even when TIFF nodata metadata is absent. Treat precisely
        # those NaN cells as missing *before* averaging; otherwise a single
        # missing pixel propagates NaN into the whole destination cell.
        # Integer masks cannot represent NaN, so retain their own metadata.
        implicit_nan = src.nodata is None and src.dtypes[index].startswith('float')
        source_nodata = float('nan') if implicit_nan else src.nodata
        result=np.zeros(shape,dtype=np.float32)
        reproject(rasterio.band(src,index+1),result,src_transform=src.transform,src_crs=src.crs,
            dst_transform=transform,dst_crs='EPSG:4326',src_nodata=source_nodata,dst_nodata=0,
            resampling=Resampling.average,warp_mem_limit=64,init_dest_nodata=True)
        polar_gutter_nan_pixels=repair_polar_outside_latitude_gutter(result,transform)
        finite_mask=np.isfinite(result)
        if not bool(finite_mask.all()):
            observed=result[finite_mask]
            print('POLAR_REPROJECT_DIAGNOSTIC='+json.dumps({
                'source':str(path),'dtype':src.dtypes[index],
                'sourceNodata':None if src.nodata is None else str(src.nodata),
                'implicitFloatNaNNoData':implicit_nan,'sourceCrs':str(src.crs),
                'targetShape':list(shape),'nonfinitePixels':int(np.count_nonzero(~finite_mask)),
                'finitePixels':int(np.count_nonzero(finite_mask)),
                'finiteMinimum':float(np.min(observed)) if observed.size else None,
                'finiteMaximum':float(np.max(observed)) if observed.size else None,
                'sampleClasses':[str(value) for value in sorted(values)],
            }),flush=True)
        diagnostics=check_polar_coverage_bounds(float(np.min(result)),float(np.max(result)),bool(finite_mask.all()))
        diagnostics.update(sourceNoData=None if src.nodata is None else str(src.nodata),
            implicitFloatNaNNoData=implicit_nan,
            polarGutterNonfinitePixelsReplicated=polar_gutter_nan_pixels,
            correctedRoundoffPixels=int(np.count_nonzero((result<0)|(result>1))))
        np.clip(result,0,1,out=result)
        print(json.dumps({'polarCoverage':diagnostics,'source':str(path),'band':index+1}),flush=True)
        if not np.any(result):raise ValueError('Polar reference ice mask is empty for review tile')
        return result,{'band':index+1,'decimalYear':rows[index],'sourceCrs':str(src.crs),'coverageValidation':diagnostics}


def build(output):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from PIL import Image
    spec=importlib.util.spec_from_file_location('natural_masks',Path(__file__).with_name('compose-natural-surface-masks.py'))
    composer=importlib.util.module_from_spec(spec);spec.loader.exec_module(composer)
    output=Path(output).resolve()
    if output.exists():raise ValueError('Immutable candidate directory already exists')
    if shutil.disk_usage(output.parent).free<8*1024**3:raise ValueError('Require bounded peak plus 5 GiB headroom')
    output.mkdir();inputs=output/'inputs';inputs.mkdir();raw=output/'acquisition-cache';raw.mkdir()
    base_data,base_record=download(BASE_ROOT+'manifest.json',raw/'base-manifest.json',2*1024**2)
    base=json.loads(base_data)
    source_records=[];results={};mask_records={}
    rgi_data,rgi_record=download(RGI_URL,raw/'rgi7-region15.zip',250*1024**2)
    if not rgi_data.startswith(b'PK'):raise ValueError('RGI public provider did not return a ZIP archive')
    rgi_record.update(id='rgi7-region15',observation='RGI7 target circa 2000; per-glacier dates vary',
        license='CC BY 4.0; RGI 7.0 Consortium 2023, DOI 10.5067/f6jmovy5navz')
    source_records.append(rgi_record)
    metadata,_=download('https://zenodo.org/api/records/15327619',raw/'polar-record.json',2*1024**2)
    metadata=json.loads(metadata)
    license_value=metadata.get('metadata',{}).get('license',{})
    license_id=license_value.get('id') if isinstance(license_value,dict) else str(license_value)
    if not license_id:raise ValueError('Polar provider license absent; preserve metadata and do not publish derived tiles')
    polar_sources={}
    for region,(filename,md5,timestamps) in POLAR.items():
        url='https://zenodo.org/records/15327619/files/'+filename+'?download=1'
        data,record=download(url,raw/filename,160*1024**2,expected_md5=md5)
        stamp,stamp_record=download('https://zenodo.org/records/15327619/files/'+timestamps+'?download=1',raw/timestamps,16384)
        record.update(id='icesat2-'+region,observation='2021 fixed band selected from observed time slices',
            license=license_id,publishedMd5=md5,timestampsSha256=stamp_record['sha256'])
        polar_sources[region]=(raw/filename,stamp.decode(),record)
        source_records.append(record)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
            GDAL_HTTP_TIMEOUT=60,GDAL_HTTP_MAX_RETRY=2,GDAL_CACHEMAX=128*1024*1024):
        for region,lon,lat in REGIONS:
            key=base['regions'][region];entry=base['tiles'][key]
            source_bytes,_=download(BASE_ROOT+key,raw/(region+'.webp'),16*1024**2,expected_sha=entry['sha256'])
            if len(source_bytes)!=entry['bytes']:raise ValueError('Base tile length mismatch')
            _,name=key.split('/');column,row=map(int,name.removesuffix('.webp').split('-'))
            pixel=1/60
            transform=from_origin(-180+(column*1024-1)*pixel,90-(row*1024-1)*pixel,pixel,pixel)
            shape=(entry['pixelHeight'],entry['pixelWidth'])
            classes=worldcover_grid(region,lon,lat,shape,transform,inputs,source_records)
            glacier=np.zeros(shape,dtype=np.float32);polar=np.zeros(shape,dtype=np.float32)
            details={'worldcoverReviewBounds':None if region in POLAR else [lon-1.5,lat-1.5,lon+1.5,lat+1.5]}
            if region=='himalaya':
                glacier,count=glacier_grid(raw/'rgi7-region15.zip',shape,transform)
                details['rgi7GlacierCount']=count
            if region in POLAR:
                path,times,record=polar_sources[region]
                polar,selection=polar_grid(path,times,shape,transform);details['polar']=selection;record['selection']=selection
            mask_path=inputs/(region+'-masks.npz')
            np.savez_compressed(mask_path,worldcover=classes,glacier=glacier,polar=polar)
            receipt_path=inputs/(region+'-composition.json')
            result=composer.compose_file(raw/(region+'.webp'),mask_path,output/key,receipt_path)
            results[key]={k:result[k] for k in ('bytes','pixelWidth','pixelHeight')}
            results[key]['sha256']=result['outputSha256'];mask_records[region]={**details,**result,'maskFile':mask_path.name}
    manifest={**base,'version':VERSION,'pathPrefix':'terrain/natural/v'+VERSION,'tiles':results,
        'sources':base['sources']+source_records,'observationMasks':mask_records,
        'activation':'bounded observed-mask candidate only; bind immutable library revision before use',
        'limitations':['WorldCover aggregation is limited to explicit 3-degree review windows, not entire world or every tile pixel',
            'RGI7 region15 is applied to the Himalayan representative tile; other mountain regions not generated',
            'Polar masks use observed 2021 bands; no inferred latitude/elevation snow and no historical reconstruction',
            'Only nine LOD4 tiles; missing LODs/regions retain the altitude-palette background',
            'Viewer screenshots and hardware performance remain independent release gates']}
    manifest.pop('sourceRevision',None)
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    receipt={'schema':'pando-natural-observed-preview-v1','sourceVersion':VERSION,'tileCount':len(results),
        'tileBytes':sum(row['bytes'] for row in results.values()),'worldcoverSourceWindows':sum(row.get('license')=='CC BY 4.0' for row in source_records),
        'observedRGI':True,'observedGreenlandIce':True,'observedAntarcticIce':True,
        'sourceManifestSha256':digest(base_data),'manifestSha256':digest((output/'manifest.json').read_bytes()),
        'pinChanged':False,'globalGeneration':False,'composition':mask_records}
    (output/'generation-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    # Original acquisitions stay in this fixed CI output until evidence is archived;
    # storage publication selects only candidate tiles, retained aligned arrays and receipts.
    print(json.dumps(receipt,indent=2))


def polar_nan_self_test():
    """Exercise the real rasterio reprojection path, not just a bounds helper."""
    import tempfile
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    data=np.array([[1,1,np.nan,0],[1,np.nan,0,0],[0,0,1,np.nan],[0,0,1,1]],dtype='float32')
    with tempfile.TemporaryDirectory(prefix='pando-natural-polar-') as directory:
        path=Path(directory)/'ice.tif'
        source_transform=from_origin(0,4,1,1)
        with rasterio.open(path,'w',driver='GTiff',height=4,width=4,count=1,
              dtype='float32',crs='EPSG:4326',transform=source_transform) as dst:
            dst.write(data,1)
        result,receipt=polar_grid(path,'2021.000',(2,2),from_origin(0,4,2,2))
        if not np.array_equal(result,np.array([[1,0],[0,1]],dtype='float32')):
            raise AssertionError('NaN nodata contaminated valid polar coverage')
        if not receipt['coverageValidation']['implicitFloatNaNNoData']:
            raise AssertionError('Explicit IEEE NaN missing-data rule was not used')
        south=np.array([[1,0],[float('nan'),float('nan')]],dtype='float32')
        south_transform=from_origin(0,-89.99166666666666,1,1/60)
        corrected=repair_polar_outside_latitude_gutter(south,south_transform)
        if corrected!=2 or not np.array_equal(south,np.array([[1,0],[1,0]],dtype='float32')):
            raise AssertionError('South-pole one-pixel outside-latitude gutter was not replicated')
        interior=np.array([[1,float('nan')],[0,0]],dtype='float32')
        if repair_polar_outside_latitude_gutter(interior,from_origin(0,-89.75,1,1/60))!=0:
            raise AssertionError('In-range missing data was silently repaired')
        if bool(np.isfinite(interior).all()):
            raise AssertionError('Interior NaN must remain a hard source-quality failure')
        print(json.dumps({'polarNaNMissingSource':True,'outputCoverage':result.tolist(),
          'strictFiniteOutput':bool(np.isfinite(result).all()),
          'southPolarGutterPixels':corrected,'interiorNaNStillRejected':True}))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--probe',action='store_true')
    parser.add_argument('--self-test-polar',action='store_true')
    args=parser.parse_args()
    if args.self_test_polar:polar_nan_self_test()
    elif args.probe:probe(args.output)
    else:build(args.output)

if __name__=='__main__':main()
