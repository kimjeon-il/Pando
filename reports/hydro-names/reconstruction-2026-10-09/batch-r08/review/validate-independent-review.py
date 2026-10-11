#!/usr/bin/env python3
"""Offline bounded river review. Optional local inputs never imply reacquisition."""
import argparse, csv, gzip, hashlib, io, json, math, struct, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
SYSTEM_IDS = ['50538951','50631583','50691033']
AWIDS = ['hydro-system:'+n for n in SYSTEM_IDS]
FIDS = [6821,6900,6978]
LOGICAL_FIDS = [1882,1956,2022]
PARTS = [209,79,88]
COUNTS = [1038,483,522]
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

def validate_features(features,root,ref):
    require([f['id'] for f in features]==FIDS,'Complete ordered selected feature set')
    facts=read_json(root/'selected-river-metadata.json')['fragments']
    reaches=read_json(root/'source-reach-manifest.json')['groups']
    observations=[]
    for i,(f,r,group,reaches_group) in enumerate(zip(features,facts,ref['groups'],reaches)):
        g,m=f['geometry'],f['properties'];pp=lines(g);xy=points(g)
        require((m['awId'],m['systemId'],m['logicalFid'],f['id'])==(AWIDS[i],SYSTEM_IDS[i],LOGICAL_FIDS[i],FIDS[i]),'Independent identifier domains')
        require(m==r['baseline_metadata_exact']==r['baseline_core_metadata_exact']|r['baseline_detail_metadata_exact'],'Exact merged/core/detail metadata')
        require(m['role']=='mainstem' and m['fragmentIndex']==0 and m['fragmentCount']==1,'Single baseline mainstem fragment')
        require(sha(canon(f))==r['baseline_feature_canonical_sha256'],'Complete feature hash')
        require(sha(canon(g))==r['geometry']['canonical_geometry_sha256'],'Complete ordered geometry hash')
        require(sha(canon(m))==r['baseline_metadata_canonical_sha256'],'Complete metadata hash')
        require([len(p) for p in pp]==r['geometry']['coordinate_counts_by_part'],'All part/vertex counts in order')
        require(len(pp)==PARTS[i]==r['geometry']['part_count'] and len(xy)==COUNTS[i]==r['geometry']['coordinate_count'],'Complete geometry counts')
        require([min(v[0] for v in xy),min(v[1] for v in xy),max(v[0] for v in xy),max(v[1] for v in xy)]==r['geometry']['bounds'],'Full bounds')
        require([pp[0][0],pp[-1][-1]]==r['geometry']['fragment_endpoints'],'Whole-fragment endpoints')
        require(all(a[-1]==b[0] for a,b in zip(pp,pp[1:])),'Internal adjacent part endpoint joins')
        for j,(part,pin) in enumerate(zip(pp,r['geometry']['ordered_parts'])):
            require(pin==dict(part_index=j,coordinate_count=len(part),ordered_coordinate_sha256=sha(canon(part))),'Every ordered part digest')
        require(len(r['geometry']['ordered_parts'])==len(pp),'Every part covered')
        ids=m['sourceId'].split(',')
        require(ids==reaches_group['fragments'][0]['source_ids_ordered'] and len(ids)==PARTS[i],'Exact source-ID order')
        require(sha(m['sourceId'].encode())==r['ordered_source_id_csv_sha256'],'Ordered source CSV hash')
        require(sha(','.join(sorted(set(ids))).encode())==group['source_ids_sha256'],'Distinct source-ID group hash')
        require(sha(canon([g]))==group['canonical_ordered_group_geometry_sha256'],'Whole ordered group hash')
        require(m['terminal']['sourceEndpoint']!=m['terminal']['renderEndpoint'],'Source/render terminal separation')
        require([round(n,6) for n in m['terminal']['renderEndpoint']]==pp[-1][-1],'Quantized render terminal')
        observations.append(dict(aw_id=AWIDS[i],fid=FIDS[i],part_count=len(pp),coordinate_count=len(xy),all_ordered_coordinates_metadata_and_source_ids_checked=True,internal_part_joins_checked=True))
    require(len(features)==len(facts)==len(ref['groups'])==len(reaches)==3,'Complete three-target coverage')
    return observations

def check_inventory(history,root,ref,pins):
    for p in ref['selected_inventory_inputs']:checked(history/p['repository_path'],p)
    rows=list(csv.DictReader(io.StringIO(gzip.decompress(checked(history/pins['initial_inventory']['repository_path'],pins['initial_inventory'])).decode())))
    require(len(rows)==len({r['aw_id'] for r in rows})==5173,'Initial inventory unique target universe')
    by_id={r['aw_id']:r for r in rows}
    selected=read_json(root/'selected-inventory-records.json')['records']
    require([r['aw_id'] for r in selected]==AWIDS,'Selected inventory order')
    for i,r in enumerate(selected):
        require(by_id[AWIDS[i]]==r['inventory_csv_row_exact'],'Every original selected CSV field')
        require(sha(canon(by_id[AWIDS[i]]))==r['inventory_csv_row_canonical_sha256'],'Original CSV row hash')
        require(int(by_id[AWIDS[i]]['logical_fid'])==LOGICAL_FIDS[i] and r['geometry_fids']==[FIDS[i]],'Original logical/geometry identity')
    eligible={r['aw_id']:r for r in rows if r['classification']!='named_display'}
    allids=pins['previous_index']['aw_ids']+AWIDS
    require(len(eligible)==4065 and len(allids)==len(set(allids))==24 and set(allids)<=set(eligible),'All24 distinct actual eligible targets')
    remaining=[r for r in eligible.values() if r['aw_id'] not in set(allids)]
    require(len(remaining)==4041 and sum(r['category']=='river' for r in remaining)==3445 and sum(r['category']=='lake' for r in remaining)==596,'Independent remaining calculations')
    return dict(initial_inventory_rows=5173,eligible_targets=4065,distinct_reviewed_targets=24,remaining_fresh_index_targets=4041,remaining_river_groups=3445,remaining_lakes=596,historical_never_reviewed_claimed=False)

def check_duplicates(d,pins):
    prior=pins['previous_index'];ids=prior['aw_ids']
    require(d['previous_index_receipt']=={k:prior[k] for k in ['bytes','sha256']},'Previous index byte receipt')
    require(d['previous_aw_ids_in_index_order']==ids and len(ids)==len(set(ids))==d['previous_target_count']==21,'Prior21 exact IDs')
    require(d['selected_aw_ids']==AWIDS and d['selected_unique_count']==3 and d['intersection_aw_ids']==[],'New ordered3')
    require(not(set(ids)&set(AWIDS)) and len(set(ids+AWIDS))==24,'Distinct cumulative24')
    require(d['historical_names_used_as_identity_evidence'] is False,'No restored historical verdicts')

CANDIDATES=['Fortescue River','Wooramel River','Greenough River']
def check_verdict(v):
    require(v['scope_aw_ids']==AWIDS and [f['aw_id'] for f in v['findings']]==AWIDS,'Review fixed order')
    require(v['baseline_commit']==COMMIT and v['prior_distinct_targets']==21 and v['current_batch_increment']==3 and v['cumulative_distinct_targets']==24 and v['duplicate_targets']==0,'Review baseline/counts')
    require(v['scalar_product_name_approvals']==0,'No scalar approvals')
    require(all(v[k] is False for k in ['automatic_application','whole_group_scalar_application_approved','geometry_modified','current_live_deployment_checked','historical_verdicts_restored','original_hydrorivers_coordinate_equality_verified']),'Review global gates')
    for i,f in enumerate(v['findings']):
        require(f['system_id']==SYSTEM_IDS[i] and f['logical_fid']==LOGICAL_FIDS[i] and f['geometry_fids']==[FIDS[i]],'Review identity domains')
        require(f['part_count']==PARTS[i] and f['coordinate_count']==COUNTS[i],'Review complete path counts')
        require(f['candidate_name']==CANDIDATES[i] and f['research_category']=='supported_representative_system_identity','Qualified representative identity')
        require(f['review_status']=='representative_system_supported_with_reach_name_limits' and f['supported_name_scope'] and f['source_keys'] and f['limits'],'Required factual finding fields')
        require(all(f[k] is None for k in ['whole_group_scalar_name','scalar_product_name','name_ko','name_en','name_original']),'No unsupported scalar or language fields')
        require(all(f[k] is False for k in ['automatic_application','whole_group_scalar_application_approved','whole_reach_name_application_cleared','scalar_product_name_approved','formal_registry_verified','exact_source_reach_name_transitions_verified']),'Finding application gates')
        require(f['complete_baseline_path_compared'] is True and f['label_overlap_alone_used_as_identity'] is False,'Whole path association scope')
    require(v['findings'][0]['associated_distinct_river_names']==['Weeli Wolli Creek','Coondiner Creek','Mindi Mindi Creek'],'Fortescue separate inflow names retained')
    require(v['findings'][1]['associated_distinct_river_names']==[] and v['findings'][2]['associated_distinct_river_names']==[],'No unsupported named tributary assignment')
    require(all(f['continuous_hydrological_flow_established'] is False for f in v['findings']),'No inferred continuous flow')
    h=v['findings'][0]['hydrological_qualification']
    require(all(t in h for t in ['Goodiadarrie Hills','upper','Marsh','lower','extreme flood']),'Fortescue hydrological distinction')

SOURCE_KEYS=['BOM-AWRA2012','FORTESCUE-DOW-HG34-2009','FORTESCUE-DBCA-JMP2025','WA-WATER-RESOURCES-INVENTORY2014','GREENOUGH-DWER-HEALTHYRIVERS']
SOURCE_DATES=[None,'2009-03','2025-09','2014',None]
ORIGINAL_REQUEST_TIMES=['2026-10-09T13:39:38.842251+00:00','2026-10-09T13:40:04.521980+00:00','2026-10-09T14:03:57.472840+00:00','2026-10-09T14:03:12.369439+00:00','2026-10-09T14:03:25.500412+00:00']
ALIASES={'FORTESCUE-BOM-AWRA2012':'BOM-AWRA2012','SOUTHWESTERN-BOM-AWRA2012':'BOM-AWRA2012'}
def check_sources(root,pins):
    assets={r['id']:r for r in pins['local_evidence_assets']};require(len(assets)==len(pins['local_evidence_assets']),'Unique local asset IDs')
    obs=read_json(root/'review/source-observations.json')
    require(obs['scope_aw_ids']==AWIDS and obs['new_external_requests']==0 and obs['source_body_republication_permitted'] is False,'Independent source boundaries')
    require(obs['independent_registered_overlay_claimed'] is False and obs['exact_source_reach_name_transitions_verified'] is False,'No unsupported map precision')
    require(obs['original_naming_source_bodies_rehashed']==5,'Five unique original naming publications')
    keys=[r['source_key'] for r in obs['observations']];require(keys==SOURCE_KEYS,'Five ordered unique naming sources')
    for i,r in enumerate(obs['observations']):
        require(set(r['checked_asset_ids'])<=set(assets),'Source observation asset IDs')
        require(r['source_body_sha256']==assets[r['body_id']]['sha256'] and assets[r['body_id']]['kind']=='original_source_body','Original body provenance')
        require(r['printed_date']==SOURCE_DATES[i],'Original publication date retained')
        require(r['original_requested_at_utc']==ORIGINAL_REQUEST_TIMES[i],'Original acquisition timestamp retained')
    require([r['map_pixels_viewed'] for r in obs['observations']]==[True,True,True,True,False],'Actual map versus text inspection')
    require(obs['observations'][0]['assessment_year']==2012 and obs['observations'][0]['copyright_year']==2013,'Assessment/copyright date separation')
    require(obs['observations'][0]['research_source_aliases']==['FORTESCUE-BOM-AWRA2012','SOUTHWESTERN-BOM-AWRA2012'],'One BOM publication under two research aliases')
    require(len(pins['original_source_receipt_links'])==5,'Five original receipt joins')
    for i,link in enumerate(pins['original_source_receipt_links']):
        require(link['source_key']==keys[i] and link['body_id'] in assets and link['receipt_id'] in assets,'Original receipt link scope')
        require(link['original_requested_at_utc']==ORIGINAL_REQUEST_TIMES[i],'Pinned original acquisition date')
    v=read_json(root/'review/independent-review.json')
    for f in v['findings']:require(set(f['source_keys'])<=set(keys),'Finding/evidence joins')
    observed_geometry=obs['complete_path_observations'];facts=read_json(root/'selected-river-metadata.json')['fragments']
    require([r['aw_id'] for r in observed_geometry]==AWIDS,'Complete path observation order')
    for o,r in zip(observed_geometry,facts):
        require(o['geometry_canonical_sha256']==r['geometry']['canonical_geometry_sha256'],'Observed whole path hash')
        require(o['part_count']==r['geometry']['part_count'] and o['coordinate_count']==r['geometry']['coordinate_count'],'Observed full path counts')
    return keys

def check_research(root,pins):
    southern=read_json(root/'research/southern-western-rivers/source-evidence.json')
    fortescue=read_json(root/'research/fortescue/fortescue-source-evidence.json')
    sources=fortescue['sources']+southern['sources'];bodypins={e['id']:e for e in pins['local_evidence_assets']}
    require(len(sources)==6 and len({ALIASES.get(s['evidence_id'],s['evidence_id']) for s in sources})==5,'Six aliases represent five publications')
    for s in sources:
        p=s.get('retrieval',s.get('acquisition',{}).get('original_pdf',{}));key=ALIASES.get(s['evidence_id'],s['evidence_id'])
        require(p['sha256']==bodypins[key+'-BODY']['sha256'] and p['bytes']==bodypins[key+'-BODY']['bytes'],'Research original source byte join')
        t=s.get('retrieval',{}).get('started_at_utc',s.get('acquisition',{}).get('requested_at_utc'))
        require(t==ORIGINAL_REQUEST_TIMES[SOURCE_KEYS.index(key)],'Research original acquisition time retained')
    require(southern['sources'][0]['cache_reuse']['retrieved_this_batch'] is False and southern['sources'][0]['cache_reuse']['original_retrieval_unchanged'] is True,'BOM reuse is not reacquisition')
    require(southern['unused_acquisition_outcomes']==[] and fortescue['new_failed_resource_requests']==[],'No hidden failed naming evidence')
    facts=read_json(root/'selected-river-metadata.json')['fragments'];ref=read_json(root/'geometry-reference.json')
    for i,name in enumerate(['wooramel','greenough'],1):
        r=read_json(root/f'research/southern-western-rivers/{name}-findings.json');g=r['geometry_integrity'];s=r['spatial_identity_check']
        require(r['target']['aw_id']==AWIDS[i] and g['canonical_fragment_geometry_sha256']==facts[i]['geometry']['canonical_geometry_sha256'],'Southern research geometry identity')
        require(g['all_line_parts_reviewed']==PARTS[i] and g['all_coordinate_positions_reviewed']==COUNTS[i] and g['ordered_source_id_csv_sha256']==facts[i]['ordered_source_id_csv_sha256'],'Southern source-order and geometry counts')
        require(s['bounded_unresolved_scope'] and all(s[k] is False for k in ['whole_group_is_one_uniform_named_channel','tributaries_inherit_representative_name','per_reach_name_assignment_cleared']),'Southern headwater/tributary scope')
        require(r['verdict']['name_ko'] is None and r['automatic_application'] is r['whole_group_scalar_application'] is r['per_reach_scalar_application'] is False,'Southern application gates')
    r=read_json(root/'research/fortescue/fortescue-geometry-comparison.json');g=r['retained_baseline_artifact']
    require(r['target_aw_id']==AWIDS[0] and g['sha256']==ref['non_distributed_decoded_feature_collection']['sha256'] and g['selected_fid']==FIDS[0] and g['selected_line_part_count']==PARTS[0] and g['selected_position_count']==COUNTS[0],'Fortescue complete path identity')
    require(all(r['review'][k] is False for k in ['topology_or_exact_alignment_verified','all_parts_individually_named','coastal_connector_name_verified','headwater_name_boundary_verified','continuous_hydrological_flow_established']),'Fortescue bounded scope')
    r=read_json(root/'research/fortescue/fortescue-findings.json')
    require(r['representative_name']==CANDIDATES[0] and r['name_ko'] is None,'Fortescue representative name')
    require(all(r[k] is False for k in ['whole_group_scalar_name_applicable','per_reach_scalar_name_applicable','automatic_application','continuous_hydrological_flow_established']),'Fortescue application and flow gates')
    require('Goodiadarrie Hills' in r['hydrological_qualification'],'Fortescue upper-Marsh-lower distinction')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent)
    p.add_argument('--input-cache',type=Path);p.add_argument('--historical-input-root',type=Path);p.add_argument('--prior-index',type=Path);p.add_argument('--local-geometry',type=Path)
    p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path);a=p.parse_args();root=a.package;review=root/'review'
    pins=read_json(review/'frozen-input-pins.json');require(pins['scope_aw_ids']==AWIDS and pins['baseline_commit']==COMMIT,'Frozen scope/baseline')
    own=read_json(review/'review-manifest.json');expected={'README.md','frozen-input-pins.json','independent-review.json','review-validation.json','source-observations.json','test-independent-review.py','validate-independent-review.py'}
    require({e['file'] for e in own['files']}==expected and own['manifest_excludes_itself'] is True,'Exact review manifest coverage')
    for e in own['files']:checked(review/e['file'],e)
    for e in pins['package_inputs']:
        q=Path(e['file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded public input path');checked(root/q,e)
    ref=read_json(root/'geometry-reference.json');require(ref['baseline']['git_commit']==COMMIT,'Geometry baseline')
    check_verdict(read_json(review/'independent-review.json'));check_duplicates(read_json(root/'geometry-duplicate-check.json'),pins);keys=check_sources(root,pins);check_research(root,pins)
    if a.prior_index:
        prior=json.loads(checked(a.prior_index,pins['previous_index']));require([r['aw_id'] for r in prior['records']]==pins['previous_index']['aw_ids'] and prior['total_distinct_reconstructed_targets']==21,'Original prior21 index')
    queue=check_inventory(a.historical_input_root,root,ref,pins) if a.historical_input_root else None
    decoded=independent_decode(a.input_cache,root,ref) if a.input_cache else None
    observed=validate_features(decoded,root,ref) if decoded else []
    if a.local_geometry:
        retained=json.loads(checked(a.local_geometry,ref['non_distributed_decoded_feature_collection']))['features'];observed=validate_features(retained,root,ref)
        require(decoded is None or decoded==retained,'Independent binary versus production full geometry')
    require(bool(a.local_source_index)==bool(a.local_source_root),'Source index/root pair');counts={};count=0
    if a.local_source_index:
        entries=read_json(a.local_source_index);local={r['id']:r for r in entries};require(len(local)==len(entries),'Unique local source map')
        for e in pins['local_evidence_assets']:
            q=Path(local[e['id']]['local_file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded retained source path');checked(a.local_source_root/q,e);counts[e['kind']]=counts.get(e['kind'],0)+1;count+=1
        for link in pins['original_source_receipt_links']:
            r=read_json(a.local_source_root/local[link['receipt_id']]['local_file']);pin=next(e for e in pins['local_evidence_assets'] if e['id']==link['body_id'])
            require(r['sha256']==pin['sha256'] and r['bytes']==pin['bytes'] and r.get('status',r.get('http_status'))==200 and r.get('url',r.get('requested_url'))==link['url'] and r.get('started_at_utc',r.get('requested_at_utc'))==link['original_requested_at_utc'],'Original receipt/body byte join')
    cmd=[sys.executable,str(root/'validate-geometry-reference.py'),'--directory',str(root),'--check-component-manifest']
    for flag,value in [('--input-cache',a.input_cache),('--historical-input-root',a.historical_input_root),('--previous-index',a.prior_index)]:
        if value:cmd.extend([flag,str(value)])
    geometry=json.loads(subprocess.run(cmd,check=True,capture_output=True,text=True).stdout)
    full=all([a.input_cache,a.historical_input_root,a.prior_index,a.local_geometry,a.local_source_index,a.local_source_root]);partial=any([a.input_cache,a.historical_input_root,a.prior_index,a.local_geometry,a.local_source_index,a.local_source_root])
    print(json.dumps(dict(status='passed',mode='full_local' if full else 'partial_local' if partial else 'durable_only',scope_aw_ids=AWIDS,public_input_files_checked=len(pins['package_inputs']),independent_binary_decoder_replayed=bool(a.input_cache),omitted_full_coordinates_rechecked=bool(a.input_cache or a.local_geometry),original_inventory_rechecked=bool(a.historical_input_root),original_prior_index_rechecked=bool(a.prior_index),local_evidence_assets_rehashed=count,local_evidence_assets_rehashed_by_kind=counts,independent_geometry_checks=observed,independent_queue_check=queue,source_provenance_keys_checked=keys,visual_inspection_repeated=False,original_hydrorivers_coordinate_equality_verified=False,network_requests=0,automatic_application=False,geometry_component=geometry,durable_only_limitation='Public facts and hashes are replayed. Omitted full coordinates and original publications are not independently reopened without local inputs; image hashing does not repeat visual review.'),indent=2))
if __name__=='__main__':main()
