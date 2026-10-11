#!/usr/bin/env python3
"""Offline bounded mixed review. Optional local inputs never imply reacquisition."""
import argparse, csv, gzip, hashlib, io, json, math, struct, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
AWIDS = ['hydro-system:70152112', 'lakes_base:1159123163', 'lakes_base:1159123567']
FIDS = [9228, 9229, 9230, 16244, 16269]
COMMIT = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
GEOMETRY_MANIFEST_SHA256 = '8d4a8eecff8bca364fb1af801d23b4a9b2fae4c4ce4b5b3c00c5d28a5b1cbac5'

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

def validate_lakes(root, ref):
    source = read_json(root/'selected-lake-geometries.geojson')['features']
    baseline = read_json(root/'selected-baseline-lake-geometries.geojson')['features']
    require([f['properties']['source_id'] for f in source]==[1159123163,1159123567], 'Lake source order')
    require([f['id'] for f in baseline]==[16244,16269], 'Lake baseline order')
    observations = []
    for src, dst, row, count in zip(source, baseline, ref['selected_features'], [92,208]):
        a,b = src['geometry'],dst['geometry']; ap,bp = polygons(a),polygons(b)
        require(sha(canon(src))==row['source_feature_canonical_sha256'], 'Source lake full feature')
        require(sha(canon(dst))==row['baseline_feature_canonical_sha256'], 'Baseline lake full feature')
        require(sha(canon(a))==row['source_geometry']['canonical_geometry_sha256'] and sha(canon(b))==row['baseline_rendered_geometry']['canonical_geometry_sha256'], 'Ordered lake geometry')
        require([[len(r) for r in p] for p in ap]==[[len(r) for r in p] for p in bp]==[[count]], 'Complete lake ring and vertex order')
        require(all(r[0]==r[-1] for p in ap+bp for r in p), 'Ring closure')
        aa,bb=points(a),points(b)
        require([[round(n,6) for n in v] for v in aa]==bb, 'Every quantized lake coordinate')
        require(dst['properties']==row['baseline_metadata_exact'] and dst['properties']['sourceId']==str(src['properties']['source_id'])==row['source_id'], 'Lake identity/metadata join')
        duplicate=sum(u==v for p in ap for r in p for u,v in zip(r,r[1:]))
        observations.append(dict(source_id=row['source_id'], position_count=count, adjacent_duplicate_positions=duplicate, every_ordered_position_checked=True))
    require(observations[0]['adjacent_duplicate_positions']==1, 'Kamianske source duplicate preserved')
    return observations

def validate_features(features, root, ref):
    require([f['id'] for f in features]==FIDS, 'Complete five-feature order')
    facts=read_json(root/'selected-river-metadata.json')['fragments']
    lakes=read_json(root/'selected-baseline-lake-geometries.geojson')['features']
    observations=[]
    for f,r in zip(features[:3],facts):
        g,m=f['geometry'],f['properties']; pp=lines(g);xy=points(g)
        require(m==r['baseline_metadata_exact'] and m['fid']==f['id']==r['fid'], 'Full river metadata and identity')
        require(m['role']==r['role']=='mainstem' and m['systemId']=='70152112', 'River role/domain')
        require(sha(canon(f))==r['baseline_feature_canonical_sha256'] and sha(canon(g))==r['geometry']['canonical_geometry_sha256'], 'Full ordered river feature hash')
        require(sha(canon(m))==r['baseline_metadata_canonical_sha256'], 'River metadata hash')
        require([len(p) for p in pp]==r['geometry']['coordinate_counts_by_part'], 'River part and vertex order')
        require(len(pp)==r['geometry']['part_count'] and len(xy)==r['geometry']['coordinate_count'], 'River complete counts')
        require([min(v[0] for v in xy),min(v[1] for v in xy),max(v[0] for v in xy),max(v[1] for v in xy)]==r['geometry']['bounds'], 'River full-coordinate bounds')
        require([pp[0][0],pp[-1][-1]]==r['geometry']['fragment_endpoints'], 'River endpoints')
        require(all(a[-1]==b[0] for a,b in zip(pp,pp[1:])), 'Internal line-part endpoint joins')
        observations.append(dict(fid=f['id'],part_count=len(pp),position_count=len(xy),ordered_geometry_and_metadata_checked=True))
    require(features[3:]==lakes, 'Independent lake decode equals included baseline')
    require(all(lines(a['geometry'])[-1][-1]==lines(b['geometry'])[0][0] for a,b in zip(features[:2],features[1:3])), 'Adjacent river fragment endpoint joins')
    require(sha(canon([f['geometry'] for f in features[:3]]))==ref['groups'][0]['canonical_ordered_group_geometry_sha256'], 'Whole ordered river group')
    require(sum(r['part_count'] for r in observations)==188 and sum(r['position_count'] for r in observations)==1279, 'Complete river counts')
    return observations

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

def check_inventory(history,root,ref):
    for pin in ref['selected_inventory_inputs']:checked(history/pin['repository_path'],pin)
    folder=history/'reports/hydro-names/current-web-2026-10-08'
    rows=list(csv.DictReader(io.StringIO(gzip.decompress((folder/'inventory.csv.gz').read_bytes()).decode())))
    summary=read_json(folder/'summary.json')
    require(summary['baseline_sha']==COMMIT and summary['manifest_sha256']==ref['baseline']['manifest_sha256'],'Historical inventory baseline')
    for expected in read_json(root/'selected-inventory-records.json')['records']:
        matches=[r for r in rows if r['aw_id']==expected['aw_id']];require(len(matches)==1,'Unique selected original inventory row');r=matches[0]
        require(int(r['logical_fid'])==expected['logical_fid'] and int(r['geometry_count'])==len(expected['geometry_fids']),'Original inventory logical/fragment join')
        require(int(r['source_ids_count'])==expected['source_ids_count'] and r['source_ids_sha256']==expected['source_ids_sha256'],'Original inventory source identity')
        require(json.loads(r['bbox'])==expected['bbox'] and int(r['minimum_stage'])==expected['minimum_stage'],'Original inventory bounds/stage')
        key='source_id' if expected['category']=='lake' else 'system_id';require(r[key]==expected[key],'Original inventory identifier domain')

def check_verdict(v):
    require(v['scope_aw_ids']==AWIDS and [f['aw_id'] for f in v['findings']]==AWIDS,'Review exact scope')
    require(v['automatic_application'] is False and v['scalar_product_name_approvals']==0 and v['whole_group_scalar_application_approved'] is False,'Review application gate')
    require(v['current_live_deployment_checked'] is False and v['original_hydrorivers_coordinate_equality_verified'] is False,'Unsupported verification claim')
    expected=['representative_candidate_hold','reservoir_identity_supported_with_geometry_extent_limit','textual_name_candidate_extent_hold']
    for f,status in zip(v['findings'],expected):
        require(f['review_status']==status and f['research_category'] and f['supported_name_scope'] and f['source_keys'] and f['limits'],'Finding evidence and scope')
        require(f['name_ko'] is None,'Unsupported Korean')
        require(all(f[k] is False for k in ['whole_group_scalar_application_approved','scalar_product_name_approved','automatic_application','formal_registry_verified']),'Finding clearance gate')
    require(v['findings'][0]['whole_reach_name_application_cleared'] is False,'Whole river naming gate')
    require(v['findings'][1]['complete_physical_reservoir_boundary_verified'] is False,'Kamianske boundary gate')
    require(v['findings'][2]['authoritative_whole_feature_map_viewed'] is False and v['findings'][2]['historical_verified_ID_recovered'] is False,'New-lake evidence gate')

def validate_dbf(local):
    header=local['EMB-NE-HEADER'].read_bytes();row=local['EMB-NE-ROW'].read_bytes()
    require(struct.unpack_from('<IHH',header,4)==(1355,len(header),len(row)),'DBF header/row lengths')
    require(header[-1]==13 and row[0]==32,'DBF record structure')
    fields={};values={};offset=1
    for pos in range(32,len(header)-1,32):
        d=header[pos:pos+32];name=d[:11].split(b'\0')[0].decode();length=d[16];fields[name]=(chr(d[11]),length,d[17]);values[name]=row[offset:offset+length].decode('utf-8').strip();offset+=length
    require(offset==len(row),'Complete retained DBF row')
    require(fields['ne_id']==('N',10,0) and values['ne_id']=='1159123567','Exact numeric DBF identity')
    require(values['name']=='' and values['name_alt']=='Theodomiro Sampaio' and values['dam_name']=='Emborcação Dam','Discovery fields preserved')
    return dict(retained_header_and_record_reparsed=True,full_original_dbf_rehashed=False,ne_id='1159123567',original_record_index_from_acquisition_receipt=1076)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent);p.add_argument('--input-cache',type=Path);p.add_argument('--historical-input-root',type=Path);p.add_argument('--local-geometry',type=Path);p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path);a=p.parse_args();root=a.package;review=root/'review'
    pins=read_json(review/'frozen-input-pins.json');require(pins['scope_aw_ids']==AWIDS,'Frozen scope')
    for entry in pins['package_inputs']:
        require(Path(entry['file']).name==entry['file'],'Flat input path');checked(root/entry['file'],entry)
    manifest=json.loads(checked(root/'geometry-component-manifest.json',dict(sha256=GEOMETRY_MANIFEST_SHA256)))
    for name,digest in manifest['files'].items():checked(root/name,dict(sha256=digest))
    ref=read_json(root/'geometry-reference.json');require(ref['baseline']['git_commit']==COMMIT,'Baseline pin')
    if a.historical_input_root:check_inventory(a.historical_input_root,root,ref)
    check_verdict(read_json(review/'independent-review.json'));lake_results=validate_lakes(root,ref)
    features=independent_decode(a.input_cache,root,ref) if a.input_cache else None
    river_results=validate_features(features,root,ref) if features else []
    if a.local_geometry:
        retained=json.loads(checked(a.local_geometry,ref['non_distributed_decoded_feature_collection']))['features'];river_results=validate_features(retained,root,ref)
        require(features is None or retained==features,'Independent binary versus production output')
    require(bool(a.local_source_index)==bool(a.local_source_root),'Source index/root pair')
    counts={};dbf=None
    if a.local_source_index:
        local={r['id']:r for r in read_json(a.local_source_index)};paths={}
        for e in pins['local_evidence_assets']:
            q=Path(local[e['id']]['local_file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded local source path');q=a.local_source_root/q;checked(q,e);paths[e['id']]=q;counts[e['kind']]=counts.get(e['kind'],0)+1
        dbf=validate_dbf(paths)
    cmd=[sys.executable,str(root/'validate-geometry-reference.py'),'--directory',str(root)]
    for flag,value in [('--input-cache',a.input_cache),('--historical-input-root',a.historical_input_root)]:
        if value:cmd += [flag,str(value)]
    geometry=json.loads(subprocess.run(cmd,check=True,capture_output=True,text=True).stdout)
    require(geometry['omitted_full_river_coordinates_rechecked']==bool(a.input_cache) and geometry['production_decoder_replayed']==bool(a.input_cache),'Truthful geometry validation mode')
    sources=read_json(review/'source-observations.json');require(sources['new_external_requests']==0 and sources['source_body_republication_permitted'] is False,'Source review limits')
    evidence_documents=[read_json(root/name) for name in ['attawapiskat-source-evidence.json','kamianske-source-evidence.json','new-lake-source-evidence.json']]
    def evidence_hashes(value):
        found=[]
        if isinstance(value,dict):
            if 'sha256' in value:found.append(value['sha256'])
            for child in value.values():found+=evidence_hashes(child)
        elif isinstance(value,list):
            for child in value:found+=evidence_hashes(child)
        return found
    recorded_hashes=set(evidence_hashes(evidence_documents))
    for e in pins['local_evidence_assets']:
        if e['kind'] in ['original_source_body','original_source_subset','tool_text_capture']:require(e['sha256'] in recorded_hashes,'Source-body pin must match frozen acquisition evidence')
    available={s.get('evidence_id',s.get('id')) for doc in evidence_documents for s in doc['sources']}

    for f in read_json(review/'independent-review.json')['findings']:require(set(f['source_keys'])<=available,'Evidence-key join')
    if (review/'review-manifest.json').exists():
        m=read_json(review/'review-manifest.json');require({r['file'] for r in m['files']}=={x.name for x in review.iterdir() if x.is_file() and x.name!='review-manifest.json'},'Review manifest exact coverage')
        for e in m['files']:require(Path(e['file']).name==e['file'],'Flat review path');checked(review/e['file'],e)
    full=all([a.input_cache,a.historical_input_root,a.local_geometry,a.local_source_index]);any_local=any([a.input_cache,a.historical_input_root,a.local_geometry,a.local_source_index])
    print(json.dumps(dict(status='passed',mode='complete_local_inputs' if full else 'partial_local_inputs' if any_local else 'durable_only',scope_aw_ids=AWIDS,frozen_package_inputs_checked=len(pins['package_inputs']),lake_coordinate_checks=lake_results,river_coordinate_checks=river_results,omitted_full_river_coordinates_rechecked=bool(features or a.local_geometry),independent_binary_decoder_replayed=bool(a.input_cache),production_decoder_replayed=bool(a.input_cache),selected_inventory_originals_rechecked=bool(a.historical_input_root),local_evidence_assets_rehashed_by_kind=counts,dbf_subset_check=dbf,full_original_dbf_rehashed=False,original_hydrorivers_coordinate_equality_verified=False,current_live_deployment_checked=False,network_requests=0,automatic_application=False,scalar_product_name_approvals=0,durable_only_limitation='Included lake coordinates and published facts are rechecked. Omitted river coordinates, source bodies and map images require optional local inputs; rehashing an image does not perform a new visual review.'),ensure_ascii=False,indent=2))
if __name__=='__main__':main()
