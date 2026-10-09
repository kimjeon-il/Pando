#!/usr/bin/env python3
"""Offline bounded lake review. Optional local inputs never imply reacquisition."""
import argparse, csv, gzip, hashlib, io, json, math, struct, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
SOURCE_IDS = ['1159112291','1159112821','1159109155']
AWIDS = ['lakes_base:'+n for n in SOURCE_IDS]
FIDS = [15611,15649,15393]
LOGICAL_FIDS = [4236,4274,4018]
COUNTS = [51,43,124]
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


def check_inventory(history,root,ref,pins):
    for p in ref['selected_inventory_inputs']:checked(history/p['repository_path'],p)
    rows=list(csv.DictReader(io.StringIO(gzip.decompress(checked(history/pins['initial_inventory']['repository_path'],pins['initial_inventory'])).decode())))
    require(len(rows)==len({r['aw_id'] for r in rows})==5173,'Initial inventory unique target universe')
    by_id={r['aw_id']:r for r in rows};selected=read_json(root/'selected-inventory-records.json')['records']
    require([r['aw_id'] for r in selected]==AWIDS,'Selected inventory order')
    for i,r in enumerate(selected):
        require(by_id[AWIDS[i]]==r['inventory_csv_row_exact'],'Every original selected CSV field')
        require(sha(canon(by_id[AWIDS[i]]))==r['inventory_csv_row_canonical_sha256'],'Original CSV row hash')
        require(int(by_id[AWIDS[i]]['logical_fid'])==LOGICAL_FIDS[i] and r['geometry_fids']==[FIDS[i]],'Original logical/geometry identity')
    eligible={r['aw_id']:r for r in rows if r['classification']!='named_display'};allids=pins['previous_index']['aw_ids']+AWIDS
    require(len(eligible)==4065 and len(allids)==len(set(allids))==33 and set(AWIDS)<=set(eligible),'Current three unique eligible targets and cumulative33 index identities')
    require(sum(x.startswith('hydro-system:') for x in allids)==16 and sum(x.startswith('lakes_base:') for x in allids)==17,'Cumulative identifier category counts')
    remaining=[r for r in eligible.values() if r['aw_id'] not in set(allids)]
    require(len(remaining)==4032 and sum(r['category']=='river' for r in remaining)==3439 and sum(r['category']=='lake' for r in remaining)==593,'Independent remaining calculations')
    return dict(initial_inventory_rows=5173,eligible_targets=4065,distinct_reviewed_targets=33,distinct_river_groups=16,distinct_lakes=17,remaining_fresh_index_targets=4032,remaining_river_groups=3439,remaining_lakes=593,historical_never_reviewed_claimed=False,prior_target_geometry_or_naming_revalidation_performed=False)

def check_duplicates(d,pins):
    prior=pins['previous_index'];ids=prior['aw_ids']
    require(d['previous_index_receipt']=={k:prior[k] for k in ['bytes','sha256']},'Previous index byte receipt')
    require(d['previous_aw_ids_in_index_order']==ids and len(ids)==len(set(ids))==d['previous_target_count']==30,'Prior30 exact IDs')
    require(d['selected_aw_ids']==AWIDS and d['selected_unique_count']==3 and d['intersection_aw_ids']==[],'New ordered3')
    require(not(set(ids)&set(AWIDS)) and len(set(ids+AWIDS))==33,'Distinct cumulative33')
    require(d['historical_names_used_as_identity_evidence'] is False,'No restored historical verdicts')
    delta=d['current_batch_delta']
    require(delta['selected_current_inventory_targets']==3 and delta['selected_current_target_types']=={'lake':3},'Current delta category')
    require(delta['reconstructed_target_count_before']==30 and delta['reconstructed_target_count_after']==33,'Cumulative delta counts')
    require(delta['initial_eligible_target_count']==4065 and delta['remaining_fresh_reconstruction_queue_before']==4035 and delta['remaining_fresh_reconstruction_queue_after']==4032,'Queue delta counts')
    require(delta['remaining_queue_types_before']=={'river_group':3439,'lake':596} and delta['remaining_queue_types_after']=={'river_group':3439,'lake':593},'Queue delta category counts')
    require(delta['historically_never_reviewed_count_claimed'] is False and delta['prior_target_geometry_or_naming_revalidation_performed'] is False,'No whole-history reaudit')

CANDIDATES=['Dauphin Lake','Cold Lake','Deschambault Lake']
CATEGORIES=['supported_generalized_water_identity','unresolved_full_feature_correspondence','supported_generalized_water_identity']
SOURCE_KEYS=['manitoba_dauphin_iwmp','eccc_dauphin_reference_index','wsa_deschambault_map','manitoba_unused_highway_redirect','eccc_deschambault_usage','alberta_cold_subregional2019_text']
SOURCE_GROUPS={'dauphin':SOURCE_KEYS[:2],'cold-deschambault':[SOURCE_KEYS[2],SOURCE_KEYS[4],SOURCE_KEYS[5]]}
MAP_VIEWED=[True,False,True,False,False,False]
START_TIMES=['2026-10-09T15:04:35.833911+00:00','2026-10-09T15:05:50.136490+00:00','2026-10-09T13:17:13.195792+00:00','2026-10-09T15:04:58.401727+00:00','2026-10-09T13:18:56.473279+00:00']
FAILURE_TIMES=['2026-10-09T15:05:14.798091+00:00','2026-10-09T15:06:05.134478+00:00','2026-10-09T15:07:39.496639+00:00']

def check_verdict(v):
    require(v['scope_aw_ids']==AWIDS and [f['aw_id'] for f in v['findings']]==AWIDS,'Review target order')
    require(v['baseline_commit']==COMMIT and v['automatic_application'] is False and v['scalar_product_name_approvals']==0,'Review baseline/application gates')
    require(v['geometry_modified'] is False and v['current_live_deployment_checked'] is False and v['historical_verdicts_restored'] is False,'Review claim limits')
    require((v['prior_distinct_targets'],v['current_batch_increment'],v['cumulative_distinct_targets'],v['duplicate_targets'])==(30,3,33,0),'Review distinct count')
    require(v['current_batch_full_feature_correspondence_reviews_completed']==2 and v['current_batch_source_limited_targets']==1,'Incomplete source coverage remains visible')
    for i,f in enumerate(v['findings']):
        require(f['source_id']==SOURCE_IDS[i] and f['logical_fid']==LOGICAL_FIDS[i] and f['geometry_fids']==[FIDS[i]],'Review identity join')
        require(f['position_count']==COUNTS[i] and f['polygon_count']==f['ring_count']==1,'Review geometry counts')
        require(f['research_category']==f['source_research_category']==CATEGORIES[i],'Bounded identity status')
        require(f['candidate_name']==CANDIDATES[i] and f['supported_name_scope'] and f['source_keys'] and f['limits'],'Evidence scope')
        require(all(f[k] is None for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','name_original','name_en']),'No unsupported scalar or language field')
        require(all(f[k] is False for k in ['automatic_application','scalar_product_name_approved','whole_polygon_name_application_cleared','formal_registry_verified','exact_shoreline_verified','label_overlap_alone_used_as_identity']),'Finding clearance gates')
        require(f['source_and_rendered_ordered_coordinates_verified'] is True,'Whole geometry checked')
        require(f['source_access_limited']==(i==1) and f['full_feature_correspondence_review_completed']==(i!=1) and f['follow_up_required']==(i==1) and f['actual_named_water_shapes_compared']==(i!=1),'Completed versus source-limited naming coverage')
        require(f['review_status']==('source_access_limited_full_feature_correspondence_unresolved' if i==1 else 'generalized_identity_supported_not_product_name_clearance'),'Review status scope')
        require(f['multiwater_extent_assessment']==('unresolved_without_inspectable_full_waterbody_map' if i==1 else 'no_separate_lake_combination_demonstrated_at_generalized_scale'),'Compound uncertainty retained')
    c=v['findings'][1]
    require(c['source_body_acquired'] is False and c['source_body_sha256'] is None and c['map_pixels_viewed'] is False,'Missing Cold original and pixels not manufactured')
    require(v['findings'][2]['nearby_distinct_map_labels']==['Wapawekka Lake','Wood Lake','Jan Lake','Mirond Lake'],'Neighboring waterbody distinctions')

def check_sources(root,pins):
    assets={r['id']:r for r in pins['local_evidence_assets']};require(len(assets)==len(pins['local_evidence_assets']),'Unique local asset IDs')
    observed=read_json(root/'review/source-observations.json');obs={r['source_key']:r for r in observed['observations']}
    require(list(obs)==SOURCE_KEYS and len(observed['observations'])==6,'Ordered independent observations')
    require(observed['scope_aw_ids']==AWIDS and observed['new_external_requests']==0,'Independent source boundaries')
    require(all(observed[k] is False for k in ['source_body_republication_permitted','independent_registered_overlay_claimed','shoreline_overlap_measured']),'No unsupported publication or precision claim')
    require((observed['original_naming_source_bodies_rehashed'],observed['original_response_bodies_rehashed_including_unused'],observed['map_publications_pixels_viewed'],observed['map_panels_pixels_viewed'],observed['text_only_capture_count'],observed['failed_original_acquisitions'])==(4,5,2,3,1,3),'Distinct publication/body/map/capture counts')
    for i,key in enumerate(SOURCE_KEYS):
        r=obs[key];require(set(r['checked_asset_ids'])<=set(assets),'Source observation asset IDs')
        require(r['map_pixels_viewed']==MAP_VIEWED[i],'Map pixels versus text-only read')
        if i<5:
            require(r['source_body_acquired'] is True and r['body_id']==key+'-BODY' and r['source_body_sha256']==assets[key+'-BODY']['sha256'],'Acquired body provenance')
            require(r['request_started_at_utc']==START_TIMES[i],'Original acquisition initiation timestamps')
            require(r['counted_as_naming_source']==(i!=3) and r['reused_original_from_prior_batch']==(i in (2,4)),'Unused redirect/reused-original distinction')
    require(obs[SOURCE_KEYS[0]]['printed_date'] is None and obs[SOURCE_KEYS[0]]['pdf_creation_date']=='2016-01-07' and obs[SOURCE_KEYS[0]]['pdf_modification_date']=='2017-12-18','Plan publication unknown versus PDF metadata')
    require(obs[SOURCE_KEYS[2]]['printed_date']=='2014-11-25' and obs[SOURCE_KEYS[2]]['scale_denominator']==1750000,'Map imprint rather than URL year')
    require(obs[SOURCE_KEYS[1]]['page_modified_date']==obs[SOURCE_KEYS[4]]['page_modified_date']=='2026-09-11','Station index page-modified date')
    c=obs[SOURCE_KEYS[5]]
    require(c['source_body_acquired'] is False and c['body_id'] is None and c['source_body_sha256'] is None and c['counted_as_naming_source'] is False and c['original_printed_date_verified_from_body'] is False,'Cold capture does not become acquired original')
    require(c['printed_date_from_text']=='2019-07-24' and c['text_capture_sha256']==assets['COLD-SUBREGIONAL-WEB-TEXT']['sha256'] and assets['COLD-SUBREGIONAL-WEB-TEXT']['kind']=='web_text_capture_only','Cold capture provenance and limited date')
    failures=observed['failed_acquisitions'];require(len(failures)==3 and [r['completed_at_utc'] for r in failures]==FAILURE_TIMES,'Three bounded failed originals')
    require(all(r['http_status']==403 and r['source_body_acquired'] is False and r['source_body_sha256'] is None and r['map_pixels_viewed'] is False and assets[r['receipt_id']]['kind']=='failed_acquisition_receipt' for r in failures),'No original bytes from failed acquisitions')
    findings=read_json(root/'review/independent-review.json')['findings']
    for group,keys in SOURCE_GROUPS.items():
        folder=root/'research'/group;manifest=read_json(folder/'research-manifest.json')
        for pin in manifest['files']:
            require(Path(pin['path']).name==pin['path'],'Bounded research manifest');checked(folder/pin['path'],pin)
        source=read_json(folder/'source-evidence.json')['sources'];require([r['source_key'] for r in source]==keys,'Research source identity/order')
        for r in source:
            key=r['source_key']
            if key==SOURCE_KEYS[5]:
                require(r['body_sha256'] is None and r['body_byte_count'] is None and r['original_body_acquired'] is False and r['original_map_visually_inspected'] is False and r['screenshot_pixels_acquired'] is False and r['external_requests_after_403'] is False,'Text-only research limitations')
                require(r['tool_text_capture_sha256']==c['text_capture_sha256'] and r['tool_text_capture_byte_count']==assets['COLD-SUBREGIONAL-WEB-TEXT']['bytes'],'Source text capture byte join')
            else:
                require(r['body_sha256']==assets[key+'-BODY']['sha256'] and r['body_byte_count']==assets[key+'-BODY']['bytes'] and r['http_status']==200,'Original research body joins')
                require(r['original_map_visually_inspected']==obs[key]['map_pixels_viewed'],'Original map inspection scope')
        ff=read_json(folder/'findings.json');require(ff['automatic_application'] is False,'Research global gate');rows=ff['records'];require([r['aw_id'] for r in rows]==(AWIDS[:1] if group=='dauphin' else AWIDS[1:]),'Research scope order')
        for r in rows:
            f=next(f for f in findings if f['aw_id']==r['aw_id']);require(r['candidate_name']==f['candidate_name'] and r['research_category']==f['source_research_category'] and r['source_keys']==f['source_keys'],'Research/review naming association')
            require(r['korean_name'] is None and r['whole_feature_scalar_name'] is None and all(r[k] is False for k in ['automatic_application','product_application','formal_registry_verified','exact_shoreline_verified']),'Source product gates')
            if group!='dauphin':require(all(r[k]==f[k] for k in ['source_access_limited','full_feature_correspondence_review_completed','follow_up_required']),'Source completed versus unresolved flags')
    require(len(pins['original_source_receipt_links'])==5,'Acquired body receipt count')
    return list(obs)

def check_source_joins(root,pins):
    ref=read_json(root/'geometry-reference.json');rr=ref['selected_features'];source=read_json(root/'selected-lake-geometries.geojson')['features']
    dau=read_json(root/'research/dauphin/target-identity-facts.json')
    require((dau['aw_id'],dau['source_id'],dau['baseline_fid'],dau['baseline_logical_fid'])==(AWIDS[0],SOURCE_IDS[0],FIDS[0],LOGICAL_FIDS[0]),'Dauphin complete identity')
    require(dau['source_geometry']==rr[0]['source_geometry'] and dau['baseline_rendered_geometry']==rr[0]['baseline_rendered_geometry'],'Dauphin complete geometry facts')
    d=read_json(root/'research/dauphin/map-scope-review.json');require(d['source_geometry_sha256']==sha(canon(source[0]['geometry'])) and d['baseline_geometry_sha256']==rr[0]['baseline_rendered_geometry']['canonical_geometry_sha256'] and d['coordinate_positions_including_closure']==51 and d['whole_source_geometry_reviewed'] is True,'Dauphin map-to-shape evidence')
    cd=read_json(root/'research/cold-deschambault/target-identity-facts.json');require([r['aw_id'] for r in cd['targets']]==AWIDS[1:],'Other lake identity scope')
    for i,r in enumerate(cd['targets'],1):
        require(r['source_id']==SOURCE_IDS[i] and r['logical_fid']==LOGICAL_FIDS[i] and r['geometry_modified'] is False,'Other lake identity domains')
        require(r['source_geometry_canonical_sha256']==sha(canon(source[i]['geometry'])) and r['source_positions_including_closure']==COUNTS[i] and r['source_ring_count']==1 and r['source_bbox']==rr[i]['source_geometry']['bbox'],'Other complete source shape')
    obs=read_json(root/'review/source-observations.json')['complete_geometry_observations'];require([r['aw_id'] for r in obs]==AWIDS,'Whole geometry observation order')
    for i,r in enumerate(obs):
        require(r['source_id']==SOURCE_IDS[i] and r['geometry_fids']==[FIDS[i]] and r['logical_fid']==LOGICAL_FIDS[i] and r['position_count']==COUNTS[i],'Whole observed identity/counts')
        require(r['source_geometry_sha256']==rr[i]['source_geometry']['canonical_geometry_sha256'] and r['baseline_geometry_sha256']==rr[i]['baseline_rendered_geometry']['canonical_geometry_sha256'],'Observed complete geometry hashes')
        require(r['entire_source_and_baseline_geometry_viewed'] is True and r['official_whole_waterbody_map_correspondence_review_completed']==(i!=1),'Geometry inspection versus official map correspondence')
    return dict(complete_source_and_baseline_shapes_checked=3,official_full_feature_correspondence_reviews_completed=2,source_limited_unresolved_targets=1,follow_up_aw_ids=[AWIDS[1]],registered_overlay_claimed=False)

def check_local_sources(index,local_root,pins,root):
    entries=read_json(index);local={r['id']:r for r in entries};require(len(local)==len(entries),'Unique local asset IDs');counts={}
    assets={r['id']:r for r in pins['local_evidence_assets']}
    for e in assets.values():
        q=Path(local[e['id']]['local_file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded local source path');checked(local_root/q,e);counts[e['kind']]=counts.get(e['kind'],0)+1
    for link in pins['original_source_receipt_links']:
        r=read_json(local_root/local[link['receipt_id']]['local_file']);body=assets[link['body_id']]
        require(r.get('sha256',r.get('source_body_sha256'))==body['sha256'] and r.get('bytes',r.get('byte_count'))==body['bytes'] and r['status']==200 and r['url']==link['url'] and r['final_url']==link['final_url'],'Original receipt/body/status join')
        require(r.get('request_time_utc',r.get('retrieval_started_utc'))==link['request_started_at_utc'],'Original request/reuse date distinction')
    observed=read_json(root/'review/source-observations.json')
    for f in observed['failed_acquisitions']:
        r=read_json(local_root/local[f['receipt_id']]['local_file']);require(r['source_body_acquired'] is False and '403' in r['error'] and r['url']==f['url'] and r['retrieval_finished_utc']==f['completed_at_utc'],'Failed original acquisition receipt')
    r=read_json(local_root/local['COLD-SUBREGIONAL-WEB-TEXT-RECEIPT']['local_file'])
    require(r['capture_sha256']==assets['COLD-SUBREGIONAL-WEB-TEXT']['sha256'] and r['capture_byte_count']==assets['COLD-SUBREGIONAL-WEB-TEXT']['bytes'] and r['original_body_acquired'] is False and r['external_requests_after_403'] is False,'Text-only capture receipt')
    require(r['observed_tool_return_utc']=='2026-10-09T15:06:50Z' and r['chronology'][1]['observed_tool_return_utc']=='2026-10-09T15:07:01Z' and r['chronology'][2]['response_finished_utc']==FAILURE_TIMES[2],'Pre-failure text/screenshot chronology')
    return counts

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent)
    p.add_argument('--input-cache',type=Path);p.add_argument('--historical-input-root',type=Path);p.add_argument('--prior-index',type=Path);p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path)
    a=p.parse_args();root=a.package;review=root/'review';pins=read_json(review/'frozen-input-pins.json')
    own=read_json(review/'review-manifest.json');require(own['scope_aw_ids']==AWIDS and own['manifest_excludes_itself'] is True and own['review_file_count_including_manifest']==8,'Review manifest scope')
    require({r['file'] for r in own['files']}=={'README.md','frozen-input-pins.json','independent-review.json','review-validation.json','source-observations.json','test-independent-review.py','validate-independent-review.py'},'Complete review file set')
    for r in own['files']:
        require(Path(r['file']).name==r['file'],'Bounded review file');checked(review/r['file'],r)
    require(pins['scope_aw_ids']==AWIDS and pins['previous_index']['durable_commit']=='480f9db0ea893051f9de9749e4786385d7daa45e','Frozen scope and previous durable commit')
    for e in pins['package_inputs']:
        q=Path(e['file']);require(not q.is_absolute() and '..' not in q.parts,'Bounded public input path');checked(root/q,e)
    manifest=read_json(root/'geometry-component-manifest.json')
    for n,pin in manifest['files'].items():checked(root/n,dict(sha256=pin) if isinstance(pin,str) else pin)
    ref=read_json(root/'geometry-reference.json');require(ref['baseline']['git_commit']==COMMIT,'Immutable baseline')
    verdict=read_json(review/'independent-review.json');check_verdict(verdict);lake=validate_lakes(root,ref);check_duplicates(read_json(root/'geometry-duplicate-check.json'),pins);source_keys=check_sources(root,pins);source_joins=check_source_joins(root,pins)
    if a.prior_index:
        prior=json.loads(checked(a.prior_index,pins['previous_index']));require([r['aw_id'] for r in prior['records']]==pins['previous_index']['aw_ids'] and prior['total_distinct_reconstructed_targets']==30,'Original prior index')
    queue=check_inventory(a.historical_input_root,root,ref,pins) if a.historical_input_root else None
    if a.input_cache:require(independent_decode(a.input_cache,root,ref)==read_json(root/'selected-baseline-rendered-geometries.geojson')['features'],'Independent binary/retained feature equality')
    require(bool(a.local_source_index)==bool(a.local_source_root),'Local source index/root pair')
    counts=check_local_sources(a.local_source_index,a.local_source_root,pins,root) if a.local_source_index else {}
    cmd=[sys.executable,str(root/'validate-geometry-reference.py'),'--directory',str(root),'--check-component-manifest']
    for flag,value in [('--input-cache',a.input_cache),('--historical-input-root',a.historical_input_root),('--previous-index',a.prior_index)]:
        if value:cmd.extend([flag,str(value)])
    geometry=json.loads(subprocess.run(cmd,check=True,capture_output=True,text=True).stdout)
    full=all([a.input_cache,a.historical_input_root,a.prior_index,a.local_source_index,a.local_source_root]);partial=any([a.input_cache,a.historical_input_root,a.prior_index,a.local_source_index,a.local_source_root])
    print(json.dumps(dict(status='passed',mode='full_local' if full else 'partial_local' if partial else 'durable_only',scope_aw_ids=AWIDS,public_input_files_checked=len(pins['package_inputs']),lake_geometry_checks=lake,independent_binary_decoder_replayed=bool(a.input_cache),original_inventory_rechecked=bool(a.historical_input_root),original_prior_index_rechecked=bool(a.prior_index),original_prior_target_count=30,current_batch_increment=3,cumulative_distinct_targets=33,duplicate_targets=0,independent_queue_check=queue,local_evidence_assets_rehashed_by_kind=counts,local_evidence_assets_rehashed=sum(counts.values()),visual_inspection_repeated=False,formal_registry_verified=False,automatic_application=False,network_requests=0,source_joins=source_joins,source_provenance_keys_checked=source_keys,geometry_component=geometry),indent=2))
if __name__=='__main__':main()
