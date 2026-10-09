#!/usr/bin/env python3
"""Offline bounded river review. Optional local inputs never imply reacquisition."""
import argparse, csv, gzip, hashlib, io, json, math, struct, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
SYSTEM_IDS = ['50766256','50779535','50782443']
AWIDS = ['hydro-system:'+n for n in SYSTEM_IDS]
FIDS = [7081,7096,7098]
GROUP_FIDS = [[7081],[7096],[7098]]
FRAGMENT_GROUPS = [0,1,2]
LOGICAL_FIDS = [2120,2133,2135]
PARTS = [36,53,31]
GROUP_PARTS = [36,53,31]
COUNTS = [218,306,181]
GROUP_COUNTS = [218,306,181]
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
    require(len(facts)==3 and len(ref['groups'])==len(reaches)==3,'Three single fragments in three groups')
    observations=[]
    for i,(f,r) in enumerate(zip(features,facts)):
        k=FRAGMENT_GROUPS[i];group=ref['groups'][k];reaches_group=reaches[k]
        g,m=f['geometry'],f['properties'];pp=lines(g);xy=points(g);fi=GROUP_FIDS[k].index(FIDS[i])
        require((m['awId'],m['systemId'],m['logicalFid'],f['id'])==(AWIDS[k],SYSTEM_IDS[k],LOGICAL_FIDS[k],FIDS[i]),'Independent identifier domains')
        require(m==r['baseline_metadata_exact']==r['baseline_core_metadata_exact']|r['baseline_detail_metadata_exact'],'Exact merged/core/detail metadata')
        require((m['role'],m['fragmentIndex'],m['fragmentCount'])==('mainstem',fi,len(GROUP_FIDS[k])),'Actual baseline mainstem roles and fragment indices')
        require(sha(canon(f))==r['baseline_feature_canonical_sha256'],'Complete feature hash')
        require(sha(canon(g))==r['geometry']['canonical_geometry_sha256'],'Complete ordered geometry hash')
        require(sha(canon(m))==r['baseline_metadata_canonical_sha256'],'Complete metadata hash')
        require([len(p) for p in pp]==r['geometry']['coordinate_counts_by_part'],'All part/vertex counts in order')
        require(len(pp)==PARTS[i]==r['geometry']['part_count'] and len(xy)==COUNTS[i]==r['geometry']['coordinate_count'],'Complete geometry counts')
        require([min(v[0] for v in xy),min(v[1] for v in xy),max(v[0] for v in xy),max(v[1] for v in xy)]==r['geometry']['bounds'],'Full bounds')
        require([pp[0][0],pp[-1][-1]]==r['geometry']['fragment_endpoints'],'Whole-fragment endpoints')
        require(all(a[-1]==b[0] for a,b in zip(pp,pp[1:])),'Internal adjacent part endpoint joins')
        require(len(r['geometry']['ordered_parts'])==len(pp),'Every part covered')
        for j,(part,pin) in enumerate(zip(pp,r['geometry']['ordered_parts'])):
            require(pin==dict(part_index=j,coordinate_count=len(part),ordered_coordinate_sha256=sha(canon(part))),'Every ordered part digest')
        ids=m['sourceId'].split(',')
        require(ids==reaches_group['fragments'][fi]['source_ids_ordered'] and len(ids)==PARTS[i],'Exact source-ID order')
        require(sha(m['sourceId'].encode())==r['ordered_source_id_csv_sha256'],'Ordered source CSV hash')
        require(m['terminal']['class']=='sea' and m['terminal']['sourceEndpoint']!=m['terminal']['renderEndpoint'],'Source/render terminal separation')
        require([round(n,6) for n in m['terminal']['renderEndpoint']]==pp[-1][-1],'Quantized render terminal')
        observations.append(dict(aw_id=AWIDS[k],fid=FIDS[i],part_count=len(pp),coordinate_count=len(xy),all_ordered_coordinates_metadata_and_source_ids_checked=True,internal_part_joins_checked=True))
    for k,group in enumerate(ref['groups']):
        fs=[f for f in features if f['id'] in GROUP_FIDS[k]];gg=[f['geometry'] for f in fs];ids=[v for f in fs for v in f['properties']['sourceId'].split(',')]
        require([f['id'] for f in fs]==group['geometry_fids']==GROUP_FIDS[k],'Ordered complete group membership')
        require(sha(','.join(sorted(set(ids))).encode())==group['source_ids_sha256'],'Distinct source-ID group hash')
        require(sha(canon(gg))==group['canonical_ordered_group_geometry_sha256'],'Whole ordered group hash')
        require(sum(len(lines(g)) for g in gg)==group['part_count']==GROUP_PARTS[k] and sum(len(points(g)) for g in gg)==group['coordinate_count']==GROUP_COUNTS[k],'Group counts')
    return observations

def check_inventory(history,root,ref,pins):
    for p in ref['selected_inventory_inputs']:checked(history/p['repository_path'],p)
    rows=list(csv.DictReader(io.StringIO(gzip.decompress(checked(history/pins['initial_inventory']['repository_path'],pins['initial_inventory'])).decode())))
    require(len(rows)==len({r['aw_id'] for r in rows})==5173,'Initial inventory unique target universe')
    by_id={r['aw_id']:r for r in rows};selected=read_json(root/'selected-inventory-records.json')['records']
    require([r['aw_id'] for r in selected]==AWIDS,'Selected inventory order')
    for i,r in enumerate(selected):
        require(by_id[AWIDS[i]]==r['inventory_csv_row_exact'],'Every original selected CSV field')
        require(sha(canon(by_id[AWIDS[i]]))==r['inventory_csv_row_canonical_sha256'],'Original CSV row hash')
        require(int(by_id[AWIDS[i]]['logical_fid'])==LOGICAL_FIDS[i] and r['geometry_fids']==GROUP_FIDS[i],'Original logical/geometry identity')
    eligible={r['aw_id']:r for r in rows if r['classification']!='named_display'};allids=pins['previous_index']['aw_ids']+AWIDS
    require(len(eligible)==4065 and len(allids)==len(set(allids))==30 and set(AWIDS)<=set(eligible),'Current3 unique eligible targets and cumulative30 unique index identities')
    require(sum(x.startswith('hydro-system:') for x in allids)==16 and sum(x.startswith('lakes_base:') for x in allids)==14,'Cumulative identifier category counts')
    remaining=[r for r in eligible.values() if r['aw_id'] not in set(allids)]
    require(len(remaining)==4035 and sum(r['category']=='river' for r in remaining)==3439 and sum(r['category']=='lake' for r in remaining)==596,'Independent remaining calculations')
    return dict(initial_inventory_rows=5173,eligible_targets=4065,distinct_reviewed_targets=30,distinct_river_groups=16,distinct_lakes=14,remaining_fresh_index_targets=4035,remaining_river_groups=3439,remaining_lakes=596,historical_never_reviewed_claimed=False)

def check_duplicates(d,pins):
    prior=pins['previous_index'];ids=prior['aw_ids']
    require(d['previous_index_receipt']=={k:prior[k] for k in ['bytes','sha256']},'Previous index byte receipt')
    require(d['previous_aw_ids_in_index_order']==ids and len(ids)==len(set(ids))==d['previous_target_count']==27,'Prior27 exact IDs')
    require(d['selected_aw_ids']==AWIDS and d['selected_unique_count']==3 and d['intersection_aw_ids']==[],'New ordered3')
    require(not(set(ids)&set(AWIDS)) and len(set(ids+AWIDS))==30,'Distinct cumulative30')
    require(d['historical_names_used_as_identity_evidence'] is False,'No restored historical verdicts')


SOURCE_KEYS=['BOM-AWRA2012', 'WA-SLUI38-2005', 'COLLIE-DWER-HEALTHYRIVERS', 'WARREN-DWER-HEALTHYRIVERS', 'KALGAN-DWER-NUTRIENT2019', 'KALGAN-DWER-RIVERHEALTH', 'WARREN-DWER-CATCHMENT-SUPPLEMENT']
SOURCE_DATES=['2013', '2005-01', None, None, '2023-08', None, None]
ORIGINAL_REQUEST_TIMES=['2026-10-09T13:39:38.842251+00:00', '2026-10-09T14:25:45.505268+00:00', '2026-10-09T14:45:03.739301+00:00', '2026-10-09T14:46:42.414026+00:00', '2026-10-09T14:45:51.037547+00:00', '2026-10-09T14:45:57.738668+00:00', '2026-10-09T14:45:09.585351+00:00']
MAP_VIEWED=[True, True, False, False, True, False, False]
REUSED=[True, True, False, False, False, False, False]
SOURCE_ALIASES=[['COLLIE-WARREN-BOM-AWRA2012', 'KALGAN-BOM-AWRA2012'], ['WA-SLUI38-2005'], ['COLLIE-DWER-HEALTHYRIVERS'], ['WARREN-DWER-HEALTHYRIVERS'], ['KALGAN-DWER-NUTRIENT2019'], ['KALGAN-DWER-RIVERHEALTH'], ['WARREN-DWER-CATCHMENT-SUPPLEMENT']]
ALIASES={'COLLIE-WARREN-BOM-AWRA2012': 'BOM-AWRA2012', 'KALGAN-BOM-AWRA2012': 'BOM-AWRA2012', 'WA-SLUI38-2005': 'WA-SLUI38-2005', 'COLLIE-DWER-HEALTHYRIVERS': 'COLLIE-DWER-HEALTHYRIVERS', 'WARREN-DWER-HEALTHYRIVERS': 'WARREN-DWER-HEALTHYRIVERS', 'KALGAN-DWER-NUTRIENT2019': 'KALGAN-DWER-NUTRIENT2019', 'KALGAN-DWER-RIVERHEALTH': 'KALGAN-DWER-RIVERHEALTH', 'WARREN-DWER-CATCHMENT-SUPPLEMENT': 'WARREN-DWER-CATCHMENT-SUPPLEMENT'}
CANDIDATES=['Collie River','Warren River','Kalgan River']
DISTINCT_NAMES=[['Collie River East','Collie River South Branch','Brunswick River','Harris River','Bingham River'],['Tone River','Perup River','Wilgarup River','Lefroy Brook','Dombakup Brook'],['Young River','Napier Creek','Boonawarrup Creek','Stony Creek','Gaalgegup Creek','King River']]
def check_verdict(v):
    require(v['scope_aw_ids']==AWIDS and [f['aw_id'] for f in v['findings']]==AWIDS,'Review fixed order')
    require(v['baseline_commit']==COMMIT and v['prior_distinct_targets']==27 and v['current_batch_increment']==3 and v['cumulative_distinct_targets']==30 and v['duplicate_targets']==0,'Review baseline/counts')
    require(v['scalar_product_name_approvals']==0,'No scalar approvals')
    require(all(v[k] is False for k in ['automatic_application','whole_group_scalar_application_approved','geometry_modified','current_live_deployment_checked','historical_verdicts_restored','original_hydrorivers_coordinate_equality_verified']),'Review global gates')
    for i,f in enumerate(v['findings']):
        require((f['system_id'],f['logical_fid'],f['geometry_fids'])==(SYSTEM_IDS[i],LOGICAL_FIDS[i],GROUP_FIDS[i]),'Review identity domains')
        require(f['part_count']==GROUP_PARTS[i] and f['coordinate_count']==GROUP_COUNTS[i],'Review complete path counts')
        require(f['candidate_name']==CANDIDATES[i] and f['research_category']=='supported_representative_system_identity','Qualified source-supported representative identity')
        require(f['review_status']=='representative_system_supported_with_reach_name_limits' and f['supported_name_scope'] and f['source_keys'] and f['limits'],'Required factual finding fields')
        require(all(f[k] is None for k in ['whole_group_scalar_name','scalar_product_name','name_ko','name_en','name_original']),'No unsupported scalar or language fields')
        require(all(f[k] is False for k in ['automatic_application','whole_group_scalar_application_approved','whole_reach_name_application_cleared','scalar_product_name_approved','formal_registry_verified','exact_source_reach_name_transitions_verified','continuous_hydrological_flow_established','estuary_or_inlet_connectors_individually_named','uniform_river_name_for_group']),'Finding application gates')
        require(f['complete_baseline_path_compared'] is True and f['label_overlap_alone_used_as_identity'] is False,'Whole path association scope')
        require(f['associated_distinct_river_names']==DISTINCT_NAMES[i],'Source distinct component and tributary names retained')
        require(f['baseline_fragment_roles']==['mainstem'] and f['baseline_stage_sequence']==[3],'Actual roles and stages retained')
    require(v['findings'][0]['receiving_water']=='Leschenault Estuary / Leschenault Inlet' and v['findings'][0]['reservoir_passage_name_assignment_verified'] is False and v['findings'][0]['eastern_continuation_name_verified'] is False,'Collie reservoir and receiving water limits')
    require(v['findings'][1]['upstream_name_distinction']=='Tone River' and v['findings'][1]['tone_warren_transition_verified'] is False,'Warren upstream Tone distinction')
    require(v['findings'][2]['receiving_water']=='Oyster Harbour' and v['findings'][2]['tidal_length_applied_to_geometry'] is False and v['findings'][2]['exact_river_harbour_transition_verified'] is False,'Kalgan tidal and harbour limits')

def check_sources(root,pins):
    assets={r['id']:r for r in pins['local_evidence_assets']};require(len(assets)==len(pins['local_evidence_assets']),'Unique local asset IDs')
    obs=read_json(root/'review/source-observations.json')
    require(obs['scope_aw_ids']==AWIDS and obs['new_external_requests']==0 and obs['source_body_republication_permitted'] is False,'Independent source boundaries')
    require(obs['independent_registered_overlay_claimed'] is False and obs['exact_source_reach_name_transitions_verified'] is False,'No unsupported map precision')
    require(obs['original_naming_source_bodies_rehashed']==6 and obs['original_source_bodies_rehashed']==7 and obs['supplemental_page_count']==1,'Unique original naming publications')
    keys=[r['source_key'] for r in obs['observations']];require(keys==SOURCE_KEYS,'Ordered unique naming sources')
    for i,r in enumerate(obs['observations']):
        require(set(r['checked_asset_ids'])<=set(assets),'Source observation asset IDs')
        require(r['source_body_sha256']==assets[r['body_id']]['sha256'] and assets[r['body_id']]['kind']=='original_source_body','Original body provenance')
        require(r['printed_date']==SOURCE_DATES[i] and r['original_requested_at_utc']==ORIGINAL_REQUEST_TIMES[i],'Original publication and acquisition dates retained')
        require(r['map_pixels_viewed']==MAP_VIEWED[i] and r['reused_original_from_prior_batch']==REUSED[i],'Actual source inspection and reuse modes')
        require(r['research_source_aliases']==SOURCE_ALIASES[i],'Publication alias deduplication')
        require(r['counted_as_supporting_publication']==(i<6),'Supplement distinction')
    require(obs['observations'][0]['assessment_year']==2012 and obs['observations'][0]['copyright_year']==2013,'Assessment/copyright date separation')
    k=keys.index('KALGAN-DWER-NUTRIENT2019');require(obs['observations'][k]['reporting_year']==2019 and obs['observations'][k]['printed_date']=='2023-08' and obs['observations'][k]['issue']==2,'Kalgan reporting/publication date and issue separation')
    require(len(pins['original_source_receipt_links'])==len(keys),'Original receipt joins')
    for i,link in enumerate(pins['original_source_receipt_links']):
        require(link['source_key']==keys[i] and link['body_id'] in assets and link['receipt_id'] in assets,'Original receipt link scope')
        require(link['original_requested_at_utc']==ORIGINAL_REQUEST_TIMES[i],'Pinned original acquisition date')
    for f in read_json(root/'review/independent-review.json')['findings']:require(set(f['source_keys'])<=set(keys),'Finding/evidence joins')
    observed=obs['complete_path_observations'];groups=read_json(root/'geometry-reference.json')['groups']
    require([r['aw_id'] for r in observed]==AWIDS,'Complete path observation order')
    for o,r in zip(observed,groups):
        require(o['geometry_canonical_sha256']==r['canonical_ordered_group_geometry_sha256'] and o['geometry_fids']==r['geometry_fids'],'Observed complete group hash and fragments')
        require(o['part_count']==r['part_count'] and o['coordinate_count']==r['coordinate_count'],'Observed full path counts')
    return keys

def check_research(root,pins):
    cw=read_json(root/'research/collie-warren/source-evidence.json');ka=read_json(root/'research/kalgan/source-evidence.json')
    sources=cw['sources']+ka['sources'];bodypins={e['id']:e for e in pins['local_evidence_assets']}
    require({ALIASES.get(s['evidence_id'],s['evidence_id']) for s in sources}==set(SOURCE_KEYS[:-1]),'Research six unique supporting publications, supplement excluded')
    for s in sources:
        key=ALIASES.get(s['evidence_id'],s['evidence_id']);p=s['retrieval'];i=SOURCE_KEYS.index(key)
        require(p['sha256']==bodypins[key+'-BODY']['sha256'] and p['bytes']==bodypins[key+'-BODY']['bytes'],'Research original source byte join')
        require(p['started_at_utc']==ORIGINAL_REQUEST_TIMES[i] and s['source_date']==SOURCE_DATES[i],'Research original dates retained')
        require(p['http_status']==200,'Successful original body')
        if REUSED[i]:
            reuse=s.get('cache_reuse',{});require(s.get('retrieved_again_this_batch',reuse.get('retrieved_this_batch')) is False,'Cached source was not reacquired')
            if reuse:require(reuse['original_retrieval_unchanged'] is True,'Cached original receipt not overwritten')
    supplemental=cw['supplemental_acquired_pages'];require(len(supplemental)==1 and supplemental[0]['counted_as_additional_independent_support'] is False,'Supplemental page not independent supporting publication')
    sp=supplemental[0]['retrieval'];spkey=SOURCE_KEYS[-1];require(sp['sha256']==bodypins[spkey+'-BODY']['sha256'] and sp['bytes']==bodypins[spkey+'-BODY']['bytes'] and sp['started_at_utc']==ORIGINAL_REQUEST_TIMES[-1],'Supplement original body provenance')
    ref=read_json(root/'geometry-reference.json')
    for i,path in enumerate(['research/collie-warren/collie-findings.json','research/collie-warren/warren-findings.json','research/kalgan/kalgan-findings.json']):
        r=read_json(root/path);g=r['geometry_integrity'];s=r['spatial_identity_check'];group=ref['groups'][i]
        require(r['target']['aw_id']==AWIDS[i] and r['target']['geometry_fids']==GROUP_FIDS[i],'Research target and whole fragment scope')
        require(g['all_baseline_fragments_reviewed']==1 and g['all_line_parts_reviewed']==GROUP_PARTS[i] and g['all_coordinate_positions_reviewed']==GROUP_COUNTS[i],'Research whole group counts')
        require(g['canonical_ordered_group_geometry_sha256']==group['canonical_ordered_group_geometry_sha256'] and g['source_ids_sha256']==group['source_ids_sha256'],'Research complete geometry and source IDs')
        require(all(s[k] is False for k in ['whole_group_is_one_uniform_named_channel','tributaries_inherit_representative_name','per_reach_name_assignment_cleared']),'Research headwater/tributary scope')
        require(r['verdict']['name_en']==CANDIDATES[i] and r['verdict']['name_ko'] is None and r['verdict']['current_formal_naming_register_verified'] is False,'Research supported English and withheld Korean/register')
        require(all(r[k] is False for k in ['automatic_application','whole_group_scalar_application','per_reach_scalar_application','scalar_product_name_application_approved']),'Research application gates')
        require(all(g[k] is False for k in ['complete_geometry_published','coordinate_or_part_order_changed','geometry_repaired','original_hydrorivers_reach_geometry_acquired','source_reach_to_line_part_correspondence_independently_verified']),'Research geometry limits')
        evidence=(root/path).parent/r['evidence_package']['source_evidence_file'];require(sha(evidence.read_bytes())==r['evidence_package']['source_evidence_sha256'],'Finding source evidence byte join')
        if i==2:
            z=r['outlet_scope'];require(z['regional_receiving_water']=='Oyster Harbour, near Albany, Western Australia' and z['documented_tidal_river_length_approx_km']==9,'Kalgan receiving harbour and source tidal statement')
            require(all(z[k] is False for k in ['tidal_length_applied_to_geometry','surveyed_outlet_verified','exact_river_harbour_transition_verified','harbour_or_terminal_connector_name_application']),'Kalgan harbour naming hold')

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
        prior=json.loads(checked(a.prior_index,pins['previous_index']));require([r['aw_id'] for r in prior['records']]==pins['previous_index']['aw_ids'] and prior['total_distinct_reconstructed_targets']==27,'Original prior27 index')
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
