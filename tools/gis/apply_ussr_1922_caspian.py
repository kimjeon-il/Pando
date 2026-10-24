"""Apply the explicitly approved1922 snapshot; preserve ZIP masters and modern data.

Run from Pando, never from the storage repository. No code in an input ZIP is run.
"""
import argparse,copy,gzip,hashlib,json,math,shutil
from pathlib import Path
from zipfile import ZipFile
from shapely.geometry import shape,mapping,LineString,Point,box,MultiPolygon
from shapely.ops import transform,unary_union,polygonize
from shapely.strtree import STRtree
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tools/historical-library/sources/ussr-1922-approved'
USSR_ZIP='ussr-1922-v2-reviewed-master-20261023.zip'
WATER_ZIP='caspian-shoreline-completed-candidate-20261024.zip'
MASTER='geometry-v2/assembly/ussr-four-founders.normalized-provisional.geojson'
DISPLAY='geometry-v2/assembly/ussr-four-founders.display-10m-provisional.geojson'
FINAL='caspian-completion/assembled-completion-candidate/'
HASHES={MASTER:'f9695322104f54439cba67730973578358e0826702eb7376739bc6fc15d33c85',DISPLAY:'09016e357ef96f2e1d8f6d130ff8ae8ccd8cc9ebb8bca6befced785905d173c2',FINAL+'waterbody-boundary-network.geojson':'f6fce5c05021ae8fa080d8bf350a73aa1f4d4e1016e2a1dfffcc49809fc7361e'}
CRS='+proj=laea +lat_0=42 +lon_0=51 +datum=WGS84 +units=m +no_defs'
TO_METRIC=Transformer.from_crs(4326,CRS,always_xy=True).transform
TO_WGS=Transformer.from_crs(CRS,4326,always_xy=True).transform
sha=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
def write(p,value):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def geometry(document):
 return shape(document['features'][0]['geometry'] if document['type']=='FeatureCollection' else document['geometry'] if document['type']=='Feature' else document)
def polygons(g):
 if g.geom_type=='Polygon':return [g]
 return [p for child in getattr(g,'geoms',[]) for p in polygons(child)]
def nonendpoint_crossings(features):
 lines=[shape(f['geometry']) for f in features];tree=STRtree(lines);bad=[]
 for i,line in enumerate(lines):
  for j in tree.query(line,predicate='intersects'):
   j=int(j)
   if j<=i:continue
   hit=line.intersection(lines[j]);points=list(hit.geoms) if hit.geom_type=='MultiPoint' else [hit]
   ends={tuple(line.coords[0]),tuple(line.coords[-1])}&{tuple(lines[j].coords[0]),tuple(lines[j].coords[-1])}
   if any(p.geom_type!='Point' or tuple(p.coords[0]) not in ends for p in points):bad.append((i,j))
 return bad
def load_approved_inputs(ussr_path=SOURCE/USSR_ZIP,water_path=SOURCE/WATER_ZIP):
 result={'zipHashes':{}}
 for path in [Path(ussr_path),Path(water_path)]:result['zipHashes'][path.name]=sha(path.read_bytes())
 with ZipFile(ussr_path) as z:
  for name,key in [(MASTER,'master'),(DISPLAY,'display')]:
   b=z.read(name)
   if sha(b)!=HASHES[name]:raise ValueError('Approved source hash mismatch: '+name)
   result[key]=json.loads(b)
  result['sourceReports']={name:z.read(name).decode('utf-8') for name in ['geometry-v2/assembly/README.md','geometry-v2/assembly/DISPLAY-REVIEW.md','qa-v2/final-artifact-handoff.json']}
 with ZipFile(water_path) as z:
  name=FINAL+'waterbody-boundary-network.geojson';b=z.read(name)
  if sha(b)!=HASHES[name]:raise ValueError('Approved network hash mismatch')
  result['network']=json.loads(b);result['water']=geometry(json.loads(z.read(FINAL+'polygon-check/waterbody-polygon-candidate.geojson')))
  result['sourceReports']['caspian-final-README.md']=z.read(FINAL+'README.md').decode('utf-8')
 if len(result['network']['features'])!=266 or not result['water'].is_valid or len(result['water'].interiors)!=68:raise ValueError('Unexpected approved water topology')
 if any(not shape(f['geometry']).is_valid or not shape(f['geometry']).is_simple for f in result['network']['features']):raise ValueError('Invalid approved boundary line')
 if nonendpoint_crossings(result['network']['features']):raise ValueError('Approved network has nonendpoint intersections')
 return result
def generalize_caspian(inputs):
 original=inputs['network']['features'];projected=[transform(TO_METRIC,shape(f['geometry'])) for f in original]
 tolerances=[]
 for f,line in zip(original,projected):
  props=f['properties'];role=props['hybrid_role'];g=shape(f['geometry'])
  protected=any(k in role for k in ['NOT_COAST','NOT_land','NOT_OBSERVED','NE_reuse']) or g.intersects(box(53.0,40.7,53.8,41.6)) or g.intersects(box(52.8,39.1,53.6,40.0))
  tol=0 if protected or props.get('simplification_m',0)>0 else min(120,max(5,math.sqrt(abs(shape({'type':'Polygon','coordinates':[list(line.coords)]}).area))*.02)) if line.is_ring else 300
  tolerances.append(tol)
 for attempt in range(9):
  features=[]
  for f,line,tol in zip(original,projected,tolerances):
   row=copy.deepcopy(f)
   if tol:
    reduced=transform(TO_WGS,line.simplify(tol,preserve_topology=True));coords=[list(c) for c in reduced.coords]
    coords[0]=f['geometry']['coordinates'][0];coords[-1]=f['geometry']['coordinates'][-1];row['geometry']={'type':'LineString','coordinates':coords}
   features.append(row)
  bad=nonendpoint_crossings(features);parts=list(polygonize(unary_union([shape(f['geometry']) for f in features])))
  water=max(parts,key=lambda p:p.area) if parts else None
  if not bad and water is not None and water.is_valid and len(water.interiors)==68 and all(shape(f['geometry']).is_simple for f in features):break
  affected={i for pair in bad for i in pair} or set(range(len(features)))
  for i in affected:tolerances[i]=tolerances[i]/2 if tolerances[i]>5 else 0
 else:raise ValueError('Cannot generalize without changing required topology')
 before=transform(TO_METRIC,inputs['water']);after=transform(TO_METRIC,water)
 metrics={'verticesBefore':sum(len(f['geometry']['coordinates'])for f in original),'verticesAfter':sum(len(f['geometry']['coordinates'])for f in features),'holesBefore':68,'holesAfter':len(water.interiors),'areaBeforeKm2':before.area/1e6,'areaAfterKm2':after.area/1e6,'boundaryHausdorffMeters':before.boundary.hausdorff_distance(after.boundary),'nonEndpointIntersections':len(bad),'adaptiveLocalRepairs':attempt,'perFeatureToleranceMeters':[{ 'id':f['properties']['hybrid_id'],'tolerance':t}for f,t in zip(features,tolerances)],'interpretation':'Display generalization, not historical positional accuracy; NOT_COAST and source roles unchanged.'}
 return {'network':{'type':'FeatureCollection','features':features},'water':water,'metrics':metrics}

def apply_countries(inputs,before_report):
 base=ROOT/'assets/data/territorial-entities/source';rows={f['id']:f for f in inputs['display']['features']};before={}
 for entity_id in rows:
  path=base/'countries'/(entity_id.replace(':','-')+'.json')
  if path.exists():
   data=read(path)
   if any(g['versionId'].endswith(':1922-12-30-reviewed-v2')for g in data['geometryVersions']):raise ValueError('Snapshot already applied; do not repeat')
   before[entity_id]=data
  elif entity_id!='state:soviet-union-transcaucasian-sfsr':raise ValueError('Missing existing identity '+entity_id)
 write(before_report,before)
 for entity_id,f in rows.items():
  path=base/'countries'/(entity_id.replace(':','-')+'.json')
  if path.exists():
   data=read(path);before[entity_id]=copy.deepcopy(data)
  else:
   if entity_id!='state:soviet-union-transcaucasian-sfsr':raise ValueError('Missing existing identity '+entity_id)
   data={'schemaVersion':2,'entityId':entity_id,'entityKind':'general','lineageId':'transcaucasian-sfsr','names':{'ko':'자캅카스 소비에트 연방 사회주의 공화국','en':'Transcaucasian Socialist Federative Soviet Republic'},'alternateNames':['TSFSR','ZSFSR','자캅카스 SFSR'],'lifetime':{'validFrom':'1922-12-30','validTo':'1936-12-04'},'parentEntityId':'state:soviet-union','instantiation':{'mode':'independent','countryUpdates':{}},'metadata':{'constituentRepublic':True,'approximateGeometry':True,'referenceDate':'1922-12-30','identityScope':'Soviet constituent-republic membership only; predecessor federation not merged','dissolutionDate':'1936-12-05'},'sourceInfo':{},'geometryVersions':[]}
   write(base/'lineages/transcaucasian-sfsr.json',{'schemaVersion':2,'lineageId':'transcaucasian-sfsr','names':data['names'],'entityRefs':[entity_id],'relations':[]})
  if any(g['versionId'].endswith(':1922-12-30-reviewed-v2') for g in data['geometryVersions']):raise ValueError('Snapshot already applied; do not repeat')
  if entity_id=='state:soviet-union':
   old=data['geometryVersions'][0];left=copy.deepcopy(old);right=copy.deepcopy(old)
   left.update(versionId=old['versionId']+'-before-reviewed-day',validTo='1922-12-29')
   right.update(versionId=old['versionId']+'-after-reviewed-day',validFrom='1925-05-13')
   for g in [left,right]:g['notes']+=' Selection coverage split around a reviewed snapshot, not a newly discovered border-change date.'
   data['geometryVersions']=[left,right];data['metadata']['representativeGeometryVersionId']=right['versionId']
  snapshot={'versionId':entity_id+':1922-12-30-reviewed-v2','validFrom':'1922-12-30','validTo':'1925-05-12','certainty':'medium','sourceId':'approved-ussr-1922-v2-reviewed-display','geometry':f['geometry'],'notes':'Approved source-backed provisional1922-12-30 snapshot. Selection through1925-05-12 by user instruction; the source remains a1922-12-30 reconstruction. Mixed source dates, claim/occupation distinction and registrations retained in immutable ZIP. Other non-Caspian/Aral/Arctic coastline context is NE5.1.1; not2026 surveyed coast.','reviewedMasterSha256':HASHES[MASTER],'displaySha256':HASHES[DISPLAY],'sourceProperties':f['properties']}
  data['geometryVersions'].append(snapshot)
  if entity_id not in before:data['metadata']['representativeGeometryVersionId']=snapshot['versionId']
  snapshot['sourceRights']='Mixed source-specific rights; baseline sourceInfo license does not cover this reconstruction. See immutable ZIP source reports.'
  if entity_id=='state:soviet-union':snapshot['constituentRepublicCount']=4
  data['sourceInfo']['approved1922']={'referenceDate':'1922-12-30','masterSha256':HASHES[MASTER],'displaySha256':HASHES[DISPLAY],'sourceZip':str((SOURCE/USSR_ZIP).relative_to(ROOT)).replace('\\','/'),'uncertainty':'Provisional mixed-source reconstruction, disputed claims and scan-specific rights retained. Not a historical survey.','snapshotValidity':'User-selected geometry coverage1922-12-30 through1925-05-12; original evidence reference date remains1922-12-30.'}
  write(path,data)
 write(base/'snapshots/ussr-1922-12-30.json',{'schemaVersion':1,'id':'ussr-1922-12-30-reviewed-v2','referenceDate':'1922-12-30','entityRefs':list(rows)})
 return before

def physical_history(result):
 base=ROOT/'assets/data/physical-land/v1';current=geometry(json.loads(gzip.decompress((base/'geometry.json.gz').read_bytes())))
 region=box(45,35,57,48);allparts=polygons(current);near=[p for p in allparts if p.intersects(region)];far=[p for p in allparts if not p.intersects(region)]
 local=unary_union([p.intersection(region)for p in near]);waterparts=polygons(region.difference(local));modern=next(p for p in waterparts if p.covers(Point(51,42)))
 historical=local.union(modern).difference(result['water'])
 if not historical.is_valid:raise ValueError('Historical local physical land invalid')
 outside=[p.difference(region)for p in near];patched=unary_union([*outside,historical]);land=MultiPolygon([*far,*polygons(patched)])
 if not patched.is_valid:raise ValueError('Patched physical land invalid')
 def asset(name,g):
  decoded=json.dumps(mapping(g),separators=(',',':')).encode();packed=bytearray(gzip.compress(decoded,compresslevel=9,mtime=0));packed[9]=10;packed=bytes(packed)
  (base/name).write_bytes(packed);return {'url':'assets/data/physical-land/v1/'+name,'encoding':'gzip','compressedBytes':len(packed),'decodedBytes':len(decoded),'sha256':sha(packed)}
 entry={'validFrom':'1922-12-30','validTo':'1925-05-12','referenceDate':'1922-12-30','id':'caspian-near1922-approved','land':asset('caspian-1922-land.json.gz',land),'water':asset('caspian-1922-water.json.gz',result['water']),'scope':'Physical water presentation only, not a sovereignty subtraction; NOT_COAST partitions are water limits, never drawn as land/banks. Display coverage through1925-05-12 is user-selected; not a surveyed1925 shore.','modernReference':'Natural Earth5.1.1, not2026 surveyed shore'}
 manifest=read(base/'manifest.json');manifest['historicalWaterbodies']=[entry];write(base/'manifest.json',manifest)
 return {'modernWaterAreaKm2':transform(TO_METRIC,modern).area/1e6,'modernWater':modern,'localLandValid':historical.is_valid,'patchedLandValid':patched.is_valid,'fullLandValid':land.is_valid,'modernFullLandValid':current.is_valid,'outsideRegionPreserved':patched.difference(region).symmetric_difference(unary_union(outside)).area<1e-12,'unchangedFarPolygonCount':len(far),'modernLandSha256':sha((base/'geometry.json.gz').read_bytes())}

ARAL_NAMES={'lakes_base:1159126555':{'previousNameKo':'사우스아랄씨호','nameKo':'남아랄해'},'lakes_base:1729982865':{'previousNameKo':'노스아랄씨호','nameKo':'북아랄해'}}

def apply_aral_names(out):
 from prepare_hydro_name_replacement_bundle import rewrite
 out.mkdir(parents=True,exist_ok=True)
 base=ROOT/'assets/data/hydro';source=base/'lakes_base.geojson';overrides=base/'hydronym-ko-overrides.json'
 data=read(source);rules=read(overrides);before={}
 for f in data['features']:
  props=f['properties'];ident=props.get('pandolab_id');review=ARAL_NAMES.get(ident)
  if not review:continue
  before[ident]=copy.deepcopy(f)
  if props['name']!=review['previousNameKo'][:-1] or props['name_ko']!=review['previousNameKo'][:-1]:raise ValueError('Unexpected source Aral name')
  props['name']=props['name_ko']=review['nameKo']
  for old in [review['previousNameKo'],review['previousNameKo'][:-1]]:rules['aliases'][old]=review['nameKo']
 if set(before)!=set(ARAL_NAMES):raise ValueError('Missing source Aral objects')
 runtime=base/'v0.13.2';manifest=read(runtime/'manifest.json');bundle=(runtime/'hydro.bin').read_bytes()
 # Only core display names change. Detail provenance, index and compressed geometry stay byte-identical.
 corrected,new_bundle,proof=rewrite(manifest,bundle,{},overrides,lake_substitutions=ARAL_NAMES)
 write(source,data);write(overrides,rules)
 for key,path in [('naturalEarthLakes',source),('hydronymOverrides',overrides),('lakeNameCorrections',overrides)]:corrected['sources'][key]['sha256']=sha(path.read_bytes())
 write(runtime/'manifest.json',corrected);(runtime/'hydro.bin').write_bytes(new_bundle)
 write(out/'aral-name-proof.json',{'beforeSourceFeatures':before,**proof,'sourceGeometryPreserved':all(f['geometry']==before[f['properties']['pandolab_id']]['geometry']for f in data['features']if f['properties'].get('pandolab_id')in before)})

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input-directory',type=Path);parser.add_argument('--aral-names-only',action='store_true');parser.add_argument('--report-directory',type=Path,required=True,help='Writable external report directory resolved by the canonical report-paths helper');args=parser.parse_args()
 out=args.report_directory.resolve();out.mkdir(parents=True,exist_ok=True)
 if args.aral_names_only:apply_aral_names(out);return
 if not args.input_directory:parser.error('--input-directory is required for the approved snapshot')
 SOURCE.mkdir(parents=True,exist_ok=True)
 for name in [USSR_ZIP,WATER_ZIP]:
  src=args.input_directory/name;dst=SOURCE/name
  if dst.exists() and sha(dst.read_bytes())!=sha(src.read_bytes()):raise ValueError('Preserve conflicting input '+name)
  if not dst.exists():shutil.copyfile(src,dst)
 inputs=load_approved_inputs();result=generalize_caspian(inputs);apply_countries(inputs,out/'before-country-objects.json');physical=physical_history(result)
 write(out/'generalization-metrics.json',result['metrics']);write(out/'display-water.geojson',{'type':'Feature','properties':{'referenceDate':'1922-12-30','status':'provisional-cartographic-near-period','sourceNetworkSha256':HASHES[FINAL+'waterbody-boundary-network.geojson']},'geometry':mapping(result['water'])})
 write(SOURCE/'caspian-display-boundary-network.geojson',result['network'])
 write(out/'input-manifest.json',{'approvedHashes':HASHES,'zipHashes':inputs['zipHashes'],'physical':{k:v for k,v in physical.items() if k!='modernWater'}})
 for name,content in inputs['sourceReports'].items():(out/(Path(name).name+'.source.txt')).write_text(content,encoding='utf-8')
 print(json.dumps({'report':str(out),'generalization':{k:v for k,v in result['metrics'].items() if k!='perFeatureToleranceMeters'}},ensure_ascii=False))
if __name__=='__main__':main()
