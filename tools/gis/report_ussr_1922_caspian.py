"""Focused application evidence. Run from Pando; originals live in library storage."""
import json,gzip,subprocess,copy,argparse
from pathlib import Path
from itertools import combinations
from shapely.geometry import shape,box,Point
from shapely.ops import unary_union,transform
from shapely.validation import explain_validity
from PIL import Image,ImageDraw,ImageFont
from apply_ussr_1922_caspian import ROOT,SOURCE,load_approved_inputs,geometry,polygons,read,write,sha,TO_METRIC,ARAL_NAMES
from prepare_hydro_name_replacement_bundle import metadata_section

BASE='36210d5fde7d4d2301d0ff1335cf728e23b24195'
REPO=ROOT/'.library-data/repository'
def git_bytes(path):
 return subprocess.check_output(['git','-c','maintenance.auto=false','-c','gc.auto=0','-C',str(REPO),'show',BASE+':'+path])

def baseline_reader():
 index=json.loads(git_bytes('archive/index.json'))['files']
 def original(path):
  entry=index[path];raw=git_bytes(entry['stored']);raw=gzip.decompress(raw)if entry['encoding']=='gzip'else raw
  assert len(raw)==entry['bytes']and sha(raw)==entry['sha256'],path
  return raw
 return original

def compare_figure(out,modern,master,display):
 # Equal extent and projection, nominal1:10M at150dpi (not historical accuracy).
 projected=[transform(TO_METRIC,g)for g in [modern,master,display]]
 extent=unary_union(projected).bounds;px_per_m=150/0.0254/10_000_000
 w=round((extent[2]-extent[0])*px_per_m)+40;h=round((extent[3]-extent[1])*px_per_m)+80
 image=Image.new('RGB',(w*2,h+55),'#f7f5ee');draw=ImageDraw.Draw(image)
 font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
 def line(g,color,offset,width):
  for p in polygons(g):
   for ring in [p.exterior,*p.interiors]:draw.line([(offset+20+(x-extent[0])*px_per_m,60+(extent[3]-y)*px_per_m)for x,y in ring.coords],fill=color,width=width)
 for k,title in enumerate(['Modern physical baseline / historic display','Approved master / generalized display']):
  draw.text((k*w+15,10),title,fill='#232323',font=font)
  line(projected[k], '#c8544a',k*w,2);line(projected[2],'#006b8b',k*w,1)
 draw.text((15,h+5),'Red: reference   Blue: display | LAEA42N51E | nominal1:10M at150dpi',fill='#232323',font=font)
 image.save(out/'caspian-comparison-10m.png',dpi=(150,150),optimize=True)
 return {'projection':'LAEA42N51E WGS84','extentMeters':list(extent),'nominalScale':10000000,'dpi':150,'pixels':image.size}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--report-directory',type=Path,required=True,help='Writable external report directory resolved by the canonical report-paths helper');args=parser.parse_args()
 out=args.report_directory.resolve();out.mkdir(parents=True,exist_ok=True)
 original=baseline_reader();inputs=load_approved_inputs();proof={}
 countries={};before={}
 for feature in inputs['display']['features']:
  ident=feature['id'];path='assets/data/territorial-entities/source/countries/'+ident.replace(':','-')+'.json';entity=read(ROOT/path)
  version=next(v for v in entity['geometryVersions']if v['versionId'].endswith(':1922-12-30-reviewed-v2'))
  assert version['geometry']==feature['geometry']and version['validFrom']=='1922-12-30'and version['validTo']=='1925-05-12'
  countries[ident]=shape(version['geometry']);assert countries[ident].is_valid
  if ident.endswith('transcaucasian-sfsr'):
   assert entity['lifetime']=={'validFrom':'1922-12-30','validTo':'1936-12-04'}and entity['parentEntityId']=='state:soviet-union'
  else:
   old=json.loads(original(path));before[ident]=old
   assert old['lifetime']==entity['lifetime']and old.get('parentEntityId')==entity.get('parentEntityId')
   if ident=='state:soviet-union':
    legacy=[v for v in entity['geometryVersions']if not v['versionId'].endswith(':1922-12-30-reviewed-v2')]
    assert len(legacy)==2 and all(v['geometry']==old['geometryVersions'][0]['geometry']for v in legacy)
    assert legacy[1]['validFrom']=='1925-05-13'
   else:assert [v for v in entity['geometryVersions']if not v['versionId'].endswith(':1922-12-30-reviewed-v2')]==old['geometryVersions']
 write(out/'before-country-objects.json',before)
 parent=countries['state:soviet-union'];children={k:v for k,v in countries.items()if k!='state:soviet-union'}
 union=unary_union(list(children.values()));difference=parent.symmetric_difference(union).area
 overlaps={a+' / '+b:ga.intersection(gb).area for(a,ga),(b,gb)in combinations(children.items(),2)}
 assert difference<1e-12 and all(area==0 for area in overlaps.values())
 proof['countries']={'validPolygons':len(countries),'parentUnionDifferenceSquareDegrees':difference,'pairOverlapsSquareDegrees':overlaps,'approvedDisplayGeometryExact':True,'legacyLifetimesAndGeometryPreserved':True,'sovereigntyWaterSubtraction':False}
 base=ROOT/'assets/data/physical-land/v1';current=geometry(json.loads(gzip.decompress((base/'geometry.json.gz').read_bytes())))
 historic=geometry(json.loads(gzip.decompress((base/'caspian-1922-land.json.gz').read_bytes())));water=geometry(json.loads(gzip.decompress((base/'caspian-1922-water.json.gz').read_bytes())))
 assert (base/'geometry.json.gz').read_bytes()==original('assets/data/physical-land/v1/geometry.json.gz')
 region=box(45,35,57,48);near=lambda g:unary_union([p for p in polygons(g)if p.intersects(region)])
 oldnear,newnear=near(current),near(historic)
 outside=newnear.difference(region).symmetric_difference(oldnear.difference(region)).area
 assert outside<1e-12 and newnear.is_valid and water.is_valid and len(water.interiors)==68
 far=lambda g:[sha(p.wkb)for p in polygons(g)if not p.intersects(region)]
 assert far(current)==far(historic)
 modern=next(p for p in polygons(region.difference(oldnear))if p.covers(Point(51,42)))
 proof['physical']={'modernAssetSha256':sha((base/'geometry.json.gz').read_bytes()),'modernBytesUnchanged':True,'outsideCaspianDifferenceSquareDegrees':outside,'unchangedFarPolygons':len(far(current)),'patchedRegionValid':newnear.is_valid,'globalModernValidity':explain_validity(current),'globalHistoricalValidity':explain_validity(historic),'waterHoles':len(water.interiors),'aralAndArcticPhysicalShapePreserved':True,'modernWaterAreaKm2':transform(TO_METRIC,modern).area/1e6}
 # Geometry, IDs, English and provenance remain exact; only two Korean properties change.
 lakes='assets/data/hydro/lakes_base.geojson';old=json.loads(original(lakes));new=read(ROOT/lakes);expected=copy.deepcopy(old)
 for f in expected['features']:
  review=ARAL_NAMES.get(f['properties'].get('pandolab_id'))
  if review:f['properties']['name']=f['properties']['name_ko']=review['nameKo']
 assert expected==new
 h='assets/data/hydro/v0.13.2/';om=json.loads(original(h+'manifest.json'));ob=original(h+'hydro.bin');nm=read(ROOT/(h+'manifest.json'));nb=(ROOT/(h+'hydro.bin')).read_bytes()
 oc=metadata_section(ob,om['metadata']['core']);nc=metadata_section(nb,nm['metadata']['core']);expected=copy.deepcopy(oc)
 for row in expected:
  if row.get('awId')in ARAL_NAMES:row['name']=ARAL_NAMES[row['awId']]['nameKo']
 assert expected==nc and metadata_section(ob,om['metadata']['detail'])==metadata_section(nb,nm['metadata']['detail'])
 section=lambda data,spec:data[spec['offset']:spec['offset']+spec['bytes']]
 oldparts=[om['index'],*om['shards']];newparts=[nm['index'],*nm['shards']]
 assert all(section(ob,a)==section(nb,b)for a,b in zip(oldparts,newparts))
 assert om['sources']['independentHydronymReplacements']==nm['sources']['independentHydronymReplacements']
 proof['aral']={'names':ARAL_NAMES,'sourceOnlyTwoKoreanNamesChanged':True,'runtimeOnlyTwoNamesChanged':True,'geometryIndexCompressedBytesUnchanged':True,'detailProvenanceUnchanged':True,'geometryAndIndexSha256':[sha(section(nb,s))for s in newparts],'beforeBundleSha256':sha(ob),'afterBundleSha256':sha(nb)}
 proof['figure']=compare_figure(out,modern,inputs['water'],water)
 write(out/'application-proof.json',proof)
 print(json.dumps({'report':str(out),'proof':proof},ensure_ascii=False))

if __name__=='__main__':main()
