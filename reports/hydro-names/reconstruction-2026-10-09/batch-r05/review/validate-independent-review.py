#!/usr/bin/env python3
"""Offline bounded lake review. Optional local inputs never imply reacquisition."""
import argparse, csv, gzip, hashlib, io, json, math, struct, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
SOURCE_IDS = ['1159110371','1159109471','1159111751']
AWIDS = ['lakes_base:'+n for n in SOURCE_IDS]
FIDS = [15485,15419,15571]
LOGICAL_FIDS = [4110,4044,4196]
COUNTS = [114,205,104]
COMMIT = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'

def require(condition, message):
    if not condition: raise ValueError(message)
def read_json(path): return json.loads(path.read_bytes())
def sha(data): return hashlib.sha256(data).hexdigest()
def canon(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
def checked(path, pin):
    data = path.read_bytes()
    require(sha(data) == pin['sha256'], 'SHA-256 mismatch: ' + path.name)
    require('bytes' not in pin or len(data) == pin['bytes'], 'Byte count: ' + path.name)
    return data

def lines(g):
    require(g['type'] in ('LineString','MultiLineString'), 'Line geometry expected')
    return [g['coordinates']] if g['type']=='LineString' else g['coordinates']
def polygons(g):
    require(g['type'] in ('Polygon','MultiPolygon'), 'Polygon geometry expected')
    return [g['coordinates']] if g['type']=='Polygon' else g['coordinates']
def points(g):
    pp = lines(g) if g['type'] in ('LineString','MultiLineString') else [r for p in polygons(g) for r in p]
    require(pp and all(len(p)>=2 for p in pp), 'Empty/short geometry part')
    xy = [v for p in pp for v in p]
    require(all(len(v)==2 and all(math.isfinite(n) for n in v) and -180<=v[0]<=180 and -90<=v[1]<=90 for v in xy), 'Invalid coordinate')
    return xy

class Varints:
    def __init__(self,data): self.data,self.p=data,0
    def u(self):
        n=shift=0
        while self.p<len(self.data) and shift<=35:
            b=self.data[self.p];self.p+=1;n|=(b&127)<<shift
            if not b&128:return n
            shift+=7
        raise ValueError('Incomplete or oversized varint')
    def s(self):
        n=self.u();return (n>>1)^-(n&1)
    def line(self):
        count=self.u();require(count>=2,'Short encoded part');x=y=0;out=[]
        for _ in range(count):
            x+=self.s();y+=self.s()
            out.append([n//1000000 if n%1000000==0 else n/1000000 for n in (x,y)])
        return out

def decode_geometry(data, kind):
    require(kind in (1,2,3,4),'Unknown geometry kind');v=Varints(data)
    if kind in (1,2):
        parts=[v.line() for _ in range(v.u())]
        require(parts and (kind!=1 or len(parts)==1),'Line type/part count')
        g=dict(type='LineString' if kind==1 else 'MultiLineString',coordinates=parts[0] if kind==1 else parts)
    else:
        parts=[[v.line() for _ in range(v.u())] for _ in range(v.u())]
        require(parts and all(parts) and (kind!=3 or len(parts)==1),'Polygon type/part count')
        require(all(r[0]==r[-1] for p in parts for r in p),'Encoded ring closure')
        g=dict(type='Polygon' if kind==3 else 'MultiPolygon',coordinates=parts[0] if kind==3 else parts)
    require(v.p==len(data),'Selected geometry trailing bytes');points(g);return g

def decode_index(data):
    require(struct.unpack_from('<IH',data)==(0x34495741,4),'Binary index format')
    tiles,logical_count,pack_count=struct.unpack_from('<III',data,8);p=20
    for _ in range(tiles):p+=7+struct.unpack_from('<H',data,p+5)[0]*4
    logical={}
    for _ in range(logical_count):
        key,n=struct.unpack_from('<IH',data,p);p+=6
        require(key not in logical,'Duplicate logical key');logical[key]=list(struct.unpack_from('<'+'I'*n,data,p));p+=n*4
    packs={}
    for _ in range(pack_count):
        key,shard,offset,length,stage=struct.unpack_from('<IHIIB',data,p);p+=15
        require(key not in packs,'Duplicate pack key');packs[key]=dict(id=key,shard=shard,offset=offset,length=length,stage=stage)
    require(p==len(data),'Index byte coverage');return logical,packs

def independent_decode(cache,root,ref):
    for name,pin in ref['source_assets'].items():checked(cache/name,pin)
    original_lakes=read_json(cache/'lakes_base.geojson')['features']
    included_lakes=read_json(root/'selected-lake-geometries.geojson')['features']
    for row,included in zip(ref['selected_features'],included_lakes):
        matches=[(i,f) for i,f in enumerate(original_lakes) if str(f['properties'].get('source_id'))==row['source_id']]
        require(len(matches)==1 and matches[0][0]==row['source_feature_zero_based_index'] and matches[0][1]==included,'Independent full original lake feature and source-ID join')
    logical,packs=decode_index(gzip.decompress((cache/'index.bin.gz').read_bytes()))
    core={r['fid']:r for r in json.loads(gzip.decompress((cache/'metadata-core.json.gz').read_bytes()))['features']}
    detail={r['fid']:r for r in json.loads(gzip.decompress((cache/'metadata-detail.json.gz').read_bytes()))['features']}
    records=read_json(root/'selected-inventory-records.json')['records'];selected_packs=set()
    for row in records:
        require(sorted(fid for fid,m in core.items() if m['awId']==row['aw_id'])==row['geometry_fids'],'Complete original-metadata selection')
        selected_packs.update(logical[row['logical_fid']])
    receipts=read_json(root/'selected-pack-receipts.json');require(selected_packs=={r['id'] for r in receipts},'Complete selected pack set');out={}
    for receipt in receipts:
        spec=packs[receipt['id']];require(all(spec[k]==receipt[k] for k in spec),'Pack/index join')
        shard=(cache/('shard-s%d.bin'%spec['shard'])).read_bytes();packed=shard[spec['offset']:spec['offset']+spec['length']]
        require(len(packed)==spec['length'] and sha(packed)==receipt['sha256'],'Pack byte hash')
        data=gzip.decompress(packed);require(struct.unpack_from('<IH',data)==(0x46485741,4),'Pack format')
        count=struct.unpack_from('<I',data,8)[0];p=12;found=[]
        for _ in range(count):
            fields=struct.unpack_from('<IIBBBBHHfiiiiII',data,p);fid,lid,category,stage,kind,flags,index,total,width=fields[:9];bounds=list(fields[9:13]);glen,wlen=fields[13:];p+=44
            require(p+glen+wlen<=len(data),'Truncated pack')
            if fid in FIDS:
                require(fid not in out,'Duplicate selected feature');m=core[fid]|detail[fid]
                require(category==(1 if m['category']=='river' else 2),'Encoded category')
                require((lid,stage,flags,index,total,bounds)==(m['logicalFid'],m['stage'],m['flags'],m['fragmentIndex'],m['fragmentCount'],m['bounds']),'Binary descriptor/metadata equality')
                require(width==struct.unpack('<f',struct.pack('<f',m['width']))[0],'Width float32 quantization')
                g=decode_geometry(data[p:p+glen],kind)
                if wlen:
                    v=Varints(data[p+glen:p+glen+wlen]);pp=lines(g);require(v.u()==len(pp),'Width part count')
                    for part in pp:
                        n=v.u();require(n==len(part),'Width vertex count');w=v.u() if n else 0
                        for _ in range(1,n):w+=v.s()
                    require(v.p==wlen,'Width byte coverage')
                out[fid]=dict(type='Feature',id=fid,properties=m,geometry=g);found.append(fid)
            p+=glen+wlen
        require(p==len(data),'Full pack byte coverage');require(found==receipt['selected_fids'],'Selected pack feature order')
    require(set(out)==set(FIDS),'Complete selected decode');return [out[f] for f in FIDS]

def validate_lakes(root,ref):
    src=read_json(root/'selected-lake-geometries.geojson')['features']
    dst=read_json(root/'selected-baseline-rendered-geometries.geojson')['features']
    require([str(f['properties']['source_id']) for f in src]==SOURCE_IDS,'Source target order')
    require([f['id'] for f in src]==AWIDS and [f['id'] for f in dst]==FIDS,'Feature identifier domains/order')
    require(ref['scope_aw_ids']==AWIDS and ref['scope_source_ids']==SOURCE_IDS,'Geometry scope')
    require([r['source_id'] for r in ref['selected_features']]==SOURCE_IDS,'Reference target order')
    out=[]
    for i,(s,d,row,n) in enumerate(zip(src,dst,ref['selected_features'],COUNTS)):
        a,b=s['geometry'],d['geometry'];ap,bp=polygons(a),polygons(b);aa,bb=points(a),points(b)
        require(a['type']==b['type']=='Polygon','Original and rendered types')
        require([[len(r) for r in p] for p in ap]==[[n]]==[[len(r) for r in p] for p in bp],'Complete ring counts/order')
        require(all(r[0]==r[-1] for p in ap+bp for r in p),'Ring closure')
        require(sha(canon(s))==row['source_feature_canonical_sha256'],'Full source feature')
        require(sha(canon(d))==row['baseline_feature_canonical_sha256'],'Full rendered feature')
        require(sha(canon(a))==row['source_geometry']['canonical_geometry_sha256'],'Ordered source geometry')
        require(sha(canon(b))==row['baseline_rendered_geometry']['canonical_geometry_sha256'],'Ordered rendered geometry')
        require([[round(x,6) for x in p] for p in aa]==bb,'Every quantized coordinate')
        require(d['properties']==row['baseline_metadata_exact'],'Complete rendered metadata')
        require((d['properties']['logicalFid'],d['properties']['fid'],d['properties']['sourceId'],d['properties']['awId'])==(LOGICAL_FIDS[i],FIDS[i],SOURCE_IDS[i],AWIDS[i]),'Exact logical/geometry/source join')
        require(s['properties']['pandolab_id']==AWIDS[i] and all(s['properties'][k]=='' for k in ['name_ko','name_en','name_original']),'Source identity and unfilled name fields')
        out.append(dict(aw_id=AWIDS[i],logical_fid=LOGICAL_FIDS[i],geometry_fid=FIDS[i],position_count=n,every_ordered_position_checked=True,all_quantized_coordinates_match=True))
    return out

def check_inventory(history,root,ref):
    for pin in ref['selected_inventory_inputs']:checked(history/pin['repository_path'],pin)
    folder=history/'reports/hydro-names/current-web-2026-10-08'
    rows=list(csv.DictReader(io.StringIO(gzip.decompress((folder/'inventory.csv.gz').read_bytes()).decode())))
    summary=read_json(folder/'summary.json')
    require(summary['baseline_sha']==COMMIT and summary['manifest_sha256']==ref['baseline']['manifest_sha256'],'Inventory baseline')
    records=read_json(root/'selected-inventory-records.json')['records']
    require([r['aw_id'] for r in records]==AWIDS,'Inventory selection order')
    for i,expected in enumerate(records):
        matches=[r for r in rows if r['aw_id']==expected['aw_id']];require(len(matches)==1,'Unique original inventory row');r=matches[0]
        require(int(r['logical_fid'])==expected['logical_fid']==LOGICAL_FIDS[i] and int(r['geometry_count'])==1==len(expected['geometry_fids']),'Inventory FIDs')
        require(expected['geometry_fids']==[FIDS[i]] and r['source_id']==expected['source_id']==SOURCE_IDS[i],'Inventory identity domain')
        require(int(r['source_ids_count'])==expected['source_ids_count']==1 and r['source_ids_sha256']==expected['source_ids_sha256'],'Inventory source identity')
        require(json.loads(r['bbox'])==expected['bbox'] and int(r['minimum_stage'])==expected['minimum_stage'],'Inventory bounds/stage')

def check_duplicates(d,pins):
    prior=pins['previous_index']
    require(d['previous_index_receipt']=={k:prior[k] for k in ['bytes','sha256']},'Prior index hash')
    require(d['previous_aw_ids_in_index_order']==prior['aw_ids'],'Prior exclusion IDs')
    require(len(set(prior['aw_ids']))==len(prior['aw_ids'])==d['previous_target_count']==12,'Prior distinct count')
    require(d['selected_aw_ids']==AWIDS and d['selected_unique_count']==3,'Increment scope')
    require(d['intersection_aw_ids']==[] and not(set(prior['aw_ids'])&set(AWIDS)),'No repeated targets')
    require(len(set(prior['aw_ids']+AWIDS))==15 and d['historical_names_used_as_identity_evidence'] is False,'Fresh distinct increment')

def check_verdict(v):
    require(v['scope_aw_ids']==AWIDS and [f['aw_id'] for f in v['findings']]==AWIDS,'Review target order')
    require(v['baseline_commit']==COMMIT and v['automatic_application'] is False and v['scalar_product_name_approvals']==0,'Review baseline/application gates')
    require(v['geometry_modified'] is False and v['current_live_deployment_checked'] is False and v['historical_verdicts_restored'] is False,'Review claim limits')
    require(v['prior_distinct_targets']==12 and v['current_batch_increment']==3 and v['cumulative_distinct_targets']==15 and v['duplicate_targets']==0,'Review distinct count')
    for i,f in enumerate(v['findings']):
        require(f['source_id']==SOURCE_IDS[i] and f['logical_fid']==LOGICAL_FIDS[i] and f['geometry_fids']==[FIDS[i]],'Review identity join')
        require(f['position_count']==COUNTS[i] and f['polygon_count']==1 and f['ring_count']==1,'Review geometry counts')
        require(f['research_category']=='whole_polygon_scope_hold' and f['review_status']=='principal_waterbody_association_supported_whole_polygon_held','Whole feature scope hold')
        require(f['candidate_name'] and f['supported_name_scope'] and f['source_keys'] and f['limits'],'Evidence scope')
        require(f['whole_feature_scalar_name'] is None and f['name_ko'] is None,'No unsupported scalar/Korean')
        require(all(f[k] is False for k in ['automatic_application','scalar_product_name_approved','whole_polygon_name_application_cleared','formal_registry_verified','exact_shoreline_verified']),'Finding clearance gates')
        require(f['actual_named_water_shapes_compared'] is True and f['label_overlap_alone_used_as_identity'] is False,'Water-shape evidence scope')
    require(v['findings'][1]['candidate_name_kind']=='descriptive_association_not_scalar_name','Lac de Gras multi-waterbody description')

def check_sources(root,pins):
    evidence=read_json(root/'research/northern-lakes-source-evidence.json')
    assets={a['id']:a for a in pins['local_evidence_assets']}
    keys=['GNWT-CARIBOU-MAP-2018','PARKS-THAIDENE-2015','DIAND-GRAS-1998','GNWT-TERS-2010']
    require([s['source_key'] for s in evidence['sources']]==keys,'Source keys/order')
    require(evidence['source_count']==4 and evidence['new_original_requests']==3 and evidence['new_original_http_200']==3,'Source acquisition scope')
    for s in evidence['sources']:
        key=s['source_key'];acq=s['acquisition'];pdf=assets[key+'-PDF'];txt=assets[key+'-TEXT']
        require(acq['original_body_sha256']==pdf['sha256'] and acq['original_body_bytes']==pdf['bytes'],'Original PDF hash scope')
        require(acq['text_extraction_sha256']==txt['sha256'] and pdf['sha256']!=txt['sha256'],'Text/PDF hash separation')
        require(s['formal_naming_instrument_verified'] is False and s['raw_original_in_public_package'] is False,'Source claim limits')
        own=s['own_factual_extraction'];checked(root/'research'/own['file'],own)
    findings=read_json(root/'research/northern-lakes-findings.json')
    require(findings['automatic_application'] is False and [r['aw_id'] for r in findings['records']]==AWIDS,'Research scope')
    for r in findings['records']:
        require(r['research_category']=='whole_polygon_scope_hold' and r['name_ko'] is None and r['automatic_application'] is False and r['reconstructed_historical_verdict'] is False,'Research naming gates')
    return keys

def check_registration(root):
    reg=read_json(root/'research/northern-lakes-registration-facts.json')
    require(reg['independent_ground_control_used'] is False and reg['measured_shoreline_overlap_or_iou'] is None and reg['pixel_label_overlap_used_as_inclusion_proof'] is False and reg['public_map_image_republication'] is False,'Registration limits')
    require(reg['page_dimensions_pdf_points']==[3456,2592] and reg['map_printed_scale_denominator']==400000,'Map dimensions/scale')
    pr=reg['projection'];R=math.radians;a=pr['semi_major_axis_m'];f=1/pr['inverse_flattening'];e=math.sqrt(f*(2-f))
    def m(x):return math.cos(x)/math.sqrt(1-e*e*math.sin(x)**2)
    def t(x):return math.tan(math.pi/4-x/2)/((1-e*math.sin(x))/(1+e*math.sin(x)))**(e/2)
    p1,p2=map(R,pr['standard_parallels_deg']);n=math.log(m(p1)/m(p2))/math.log(t(p1)/t(p2));F=m(p1)/(n*t(p1)**n);rho0=a*F*t(R(pr['latitude_of_origin_deg']))**n
    def project(lon,lat):
        rho=a*F*t(R(lat))**n;theta=n*R(lon-pr['central_meridian_deg']);xy=[rho*math.sin(theta),rho0-rho*math.cos(theta),1]
        return [sum(v*reg['projected_xy_plus_one_to_top_left_pdf_xy_matrix'][j][i] for j,v in enumerate(xy)) for i in range(2)]
    for ctrl,res in zip(reg['four_embedded_corner_controls'],reg['four_corner_fit_residual_pdf_points']):
        q=project(ctrl['longitude'],ctrl['latitude']);r=math.hypot(*[u-v for u,v in zip(q,ctrl['pdf_point'])]);require(abs(r-res)<1e-8,'Corner-fit residual consistency')
    features=read_json(root/'selected-lake-geometries.geojson')['features']
    require([r['aw_id'] for r in reg['records']]==AWIDS,'Registration target order')
    for feat,row,count in zip(features,reg['records'],COUNTS):
        xy=[project(*q) for q in points(feat['geometry'])];box=[min(p[0] for p in xy),min(p[1] for p in xy),max(p[0] for p in xy),max(p[1] for p in xy)]
        require(all(abs(a-b)<1e-7 for a,b in zip(box,row['projected_pdf_point_bbox'])),'Every transformed source point/bbox')
        require(sha(canon(feat['geometry']))==row['geometry_sha256'] and len(xy)==row['coordinate_count_including_ring_closures']==count,'Overlay geometry/complete count')
        require(row['all_coordinates_transformed'] is True and row['simplification_applied'] is False,'Overlay coverage')
    return dict(all_423_source_positions_projected=True,ground_control_accuracy_verified=False,shoreline_overlap_measured=False)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent)
    p.add_argument('--input-cache',type=Path);p.add_argument('--historical-input-root',type=Path);p.add_argument('--prior-index',type=Path)
    p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path)
    a=p.parse_args();root=a.package;review=root/'review';pins=read_json(review/'frozen-input-pins.json')
    own=read_json(review/'review-manifest.json');require(own['scope_aw_ids']==AWIDS and own['manifest_excludes_itself'] is True and own['review_file_count_including_manifest']==8,'Review manifest scope')
    require({r['file'] for r in own['files']}=={'README.md','frozen-input-pins.json','independent-review.json','review-validation.json','source-observations.json','test-independent-review.py','validate-independent-review.py'},'Complete review manifest file set')
    for r in own['files']:
        require(Path(r['file']).name==r['file'],'Bounded review file');checked(review/r['file'],r)
    require(pins['scope_aw_ids']==AWIDS,'Frozen scope')
    for e in pins['package_inputs']:
        q=Path(e['file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded pinned path');checked(root/q,e)
    manifest=read_json(root/'geometry-component-manifest.json')
    for n,pin in manifest['files'].items():checked(root/n,dict(sha256=pin) if isinstance(pin,str) else pin)
    ref=read_json(root/'geometry-reference.json');require(ref['baseline']['git_commit']==COMMIT,'Immutable baseline')
    findings=read_json(review/'independent-review.json');check_verdict(findings);lake=validate_lakes(root,ref)
    check_duplicates(read_json(root/'geometry-duplicate-check.json'),pins)
    source_keys=check_sources(root,pins);registration=check_registration(root)
    if a.prior_index:
        prior=json.loads(checked(a.prior_index,pins['previous_index']));require([r['aw_id'] for r in prior['records']]==pins['previous_index']['aw_ids'] and prior['total_distinct_reconstructed_targets']==12,'Original prior index')
    if a.historical_input_root:check_inventory(a.historical_input_root,root,ref)
    if a.input_cache:
        decoded=independent_decode(a.input_cache,root,ref)
        require(decoded==read_json(root/'selected-baseline-rendered-geometries.geojson')['features'],'Independent binary/production feature equality')
    require(bool(a.local_source_index)==bool(a.local_source_root),'Source index/root pair')
    counts={};source_asset_count=0
    if a.local_source_index:
        entries=read_json(a.local_source_index);local={r['id']:r for r in entries};require(len(local)==len(entries),'Duplicate local asset IDs')
        for e in pins['local_evidence_assets']:
            q=Path(local[e['id']]['local_file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded local source path')
            checked(a.local_source_root/q,e);counts[e['kind']]=counts.get(e['kind'],0)+1;source_asset_count+=1
    sources=read_json(review/'source-observations.json')
    require(sources['scope_aw_ids']==AWIDS and sources['new_external_requests']==0 and sources['source_body_republication_permitted'] is False,'Source review limits')
    keyset={s['source_key'] for s in sources['observations']}
    require(all(set(f['source_keys'])<=keyset for f in findings['findings']),'Finding/source observation joins')
    require(all(set(s['checked_asset_ids'])<={x['id'] for x in pins['local_evidence_assets']} for s in sources['observations']),'Observed asset pins')
    cmd=[sys.executable,str(root/'validate-geometry-reference.py'),'--directory',str(root),'--check-component-manifest']
    for flag,value in [('--input-cache',a.input_cache),('--historical-input-root',a.historical_input_root),('--previous-index',a.prior_index)]:
        if value:cmd.extend([flag,str(value)])
    geometry=json.loads(subprocess.run(cmd,check=True,capture_output=True,text=True).stdout)
    full=all([a.input_cache,a.historical_input_root,a.prior_index,a.local_source_index,a.local_source_root])
    partial=any([a.input_cache,a.historical_input_root,a.prior_index,a.local_source_index,a.local_source_root])
    print(json.dumps(dict(status='passed',mode='full_local' if full else 'partial_local' if partial else 'durable_only',scope_aw_ids=AWIDS,public_input_files_checked=len(pins['package_inputs']),lake_geometry_checks=lake,independent_binary_decoder_replayed=bool(a.input_cache),original_inventory_rechecked=bool(a.historical_input_root),original_prior_index_rechecked=bool(a.prior_index),original_prior_target_count=12,current_batch_increment=3,cumulative_distinct_targets=15,duplicate_targets=0,local_evidence_assets_rehashed_by_kind=counts,local_evidence_assets_rehashed=source_asset_count,visual_inspection_repeated=False,formal_registry_verified=False,automatic_application=False,network_requests=0,registration_internal_consistency=registration,source_provenance_keys_checked=source_keys,geometry_component=geometry),indent=2))
if __name__=='__main__':main()
