#!/usr/bin/env python3
"""Local-only reviewer checks. No imports from the author's validator, network, or source edits."""
import argparse, csv, gzip, hashlib, json, math
from pathlib import Path

EXPECTED = [('1159109497', 15421, 4046, 228, 173), ('1159106899', 15218, 3843, 25, 104), ('1159107065', 15236, 3861, 43, 105)]
def sha(b): return hashlib.sha256(b).hexdigest()
def canon(x): return json.dumps(x, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
def load(p): return json.loads(p.read_bytes())
def record(p):
    b=p.read_bytes(); return {'bytes':len(b),'sha256':sha(b)}
def verify_file(p,r):
    actual=record(p)
    assert actual['sha256']==r['sha256'],str(p)
    if 'bytes' in r: assert actual['bytes']==r['bytes'],str(p)
    return actual

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent.parent)
    ap.add_argument('--input-cache', type=Path)
    ap.add_argument('--historical-root', type=Path)
    ap.add_argument('--local-originals',action='store_true',help='Rehash cached map/page bytes listed in review source observations.')
    a=ap.parse_args(); root=a.directory
    pins=load(root/'review/frozen-input-pins.json')
    for name,pin in pins['files'].items():verify_file(root/name,pin)
    component=load(root/'geometry-component-manifest.json')
    for name,h in component['files'].items():verify_file(root/name,{'sha256':h})
    reference=load(root/'geometry-reference.json')
    for name,r in reference['artifacts'].items():verify_file(root/name,r)
    src=load(root/'selected-lake-geometries.geojson')['features']
    dst=load(root/'selected-baseline-rendered-geometries.geojson')['features']
    assert len(src)==len(dst)==3
    assert reference['baseline']['git_commit']=='fd6744f5e72a0c1a107452dbde6d416ab57237db'
    assert reference['baseline']['current_live_deployment_checked'] is False
    checks=[]
    for s,d,e,r in zip(src,dst,EXPECTED,reference['selected_features']):
        sid,fid,logical,index,count=e
        assert str(s['properties']['source_id'])==sid==d['properties']['sourceId']==r['source_id']
        assert s['id']==d['id']==r['aw_id']=='lakes_base:'+sid
        assert d['properties']['fid']==r['baseline_fid']==fid
        assert d['properties']['logicalFid']==r['baseline_logical_fid']==logical
        assert r['source_feature_zero_based_index']==index
        assert d['properties']==r['baseline_metadata_exact']
        assert d['properties']['fragmentIndex']==0 and d['properties']['fragmentCount']==1
        assert all(s['properties'][k]=='' for k in ['name_ko','name_en','name_original'])
        assert sha(sid.encode())==r['source_ids_sha256']
        assert sha(canon(s))==r['source_feature_canonical_sha256']
        assert sha(canon(d))==r['baseline_feature_canonical_sha256']
        for f,label in [(s,'source_geometry'),(d,'baseline_rendered_geometry')]:
            g=f['geometry']; gr=r[label]
            assert g['type']=='Polygon' and len(g['coordinates'])==1
            xy=g['coordinates'][0]
            assert len(xy)==count and xy[0]==xy[-1]
            assert all(len(p)==2 and all(math.isfinite(n) for n in p) and -180<=p[0]<=180 and -90<=p[1]<=90 for p in xy)
            bbox=[min(p[0] for p in xy),min(p[1] for p in xy),max(p[0] for p in xy),max(p[1] for p in xy)]
            assert bbox==gr['bbox'] and count==gr['total_coordinates_including_closure']
            assert gr['polygon_part_count']==1 and gr['ring_counts_by_part']==[1] and gr['coordinate_counts_by_part_and_ring']==[[count]]
            assert sha(canon(g))==gr['canonical_geometry_sha256']
        pairs=list(zip(s['geometry']['coordinates'][0],d['geometry']['coordinates'][0]))
        assert all([round(x,6) for x in p]==q for p,q in pairs)
        max_delta=max(abs(x-y) for p,q in pairs for x,y in zip(p,q))
        assert max_delta==r['source_to_baseline_comparison']['maximum_absolute_coordinate_difference_degrees']
        assert [round(v*1e6) for v in r['baseline_rendered_geometry']['bbox']]==d['properties']['bounds']
        checks.append({'source_id':sid,'fid':fid,'logical_fid':logical,'source_index':index,'positions_including_closure':count,'all_ordered_positions_match_quantized_baseline':True,'maximum_absolute_coordinate_delta_degrees':max_delta})
    canada=load(root/'canada-findings.json')['findings']
    becharof=load(root/'becharof-findings.json')
    assert len(canada)==2 and {f['source_id'] for f in canada}=={'1159109497','1159107065'}
    for f in canada:
        rr=next(r for r in reference['selected_features'] if r['source_id']==f['source_id'])
        assert f['source_geometry']==rr['source_geometry'] and f['source_feature_canonical_sha256']==rr['source_feature_canonical_sha256']
        assert f['baseline_fid']==rr['baseline_fid'] and f['baseline_logical_fid']==rr['baseline_logical_fid']
        assert f['name_ko'] is None and f['current_live_deployment_checked'] is False
    assert canada[0]['verdict']=='manual_hold_main_body_match_whole_polygon_scope_unresolved'
    assert becharof['target']['source_id']=='1159106899' and becharof['verdict']['name_ko'] is None
    rr=reference['selected_features'][1]
    assert becharof['geometry_integrity']['source_geometry']==rr['source_geometry']
    assert becharof['geometry_integrity']['baseline_rendered_geometry']==rr['baseline_rendered_geometry']
    assert becharof['geometry_integrity']['source_feature_canonical_sha256']==rr['source_feature_canonical_sha256']
    source_input_checks=[]
    if a.input_cache:
        for name,r in reference['source_assets'].items():source_input_checks.append({'name':name,**verify_file(a.input_cache/name,r)})
        original=load(a.input_cache/'lakes_base.geojson')['features']
        c=json.loads(gzip.decompress((a.input_cache/'metadata-core.json.gz').read_bytes()))['features']
        d=json.loads(gzip.decompress((a.input_cache/'metadata-detail.json.gz').read_bytes()))['features']
        assert len({row['fid'] for row in c})==len(c) and len({row['fid'] for row in d})==len(d)
        for source,rendered,e in zip(src,dst,EXPECTED):
            sid,fid,logical,index,count=e
            assert sum(str(x['properties']['source_id'])==sid for x in original)==1
            assert source==original[index]
            cr=[x for x in c if x['fid']==fid]; dr=[x for x in d if x['fid']==fid]
            assert len(cr)==len(dr)==1 and cr[0]|dr[0]==rendered['properties']
        manifest=load(a.input_cache/'baseline-manifest.json')
        assert manifest['index']['sha256']==record(a.input_cache/'index.bin.gz')['sha256']
        shard=(a.input_cache/'shard-s0.bin').read_bytes()
        assert manifest['shards'][0]['sha256']==sha(shard)
        for p in load(root/'selected-pack-receipts.json'):
            assert p['shard']==0 and p['offset']>=0 and p['length']>0 and p['offset']+p['length']<=len(shard)
            assert sha(shard[p['offset']:p['offset']+p['length']])==p['sha256']
    historical_checks=[]
    if a.historical_root:
        summary=load(a.historical_root/'summary.json')
        assert summary['baseline_sha']==reference['baseline']['git_commit'] and summary['manifest_sha256']==reference['baseline']['manifest_sha256']
        for name in ['lakes_base.geojson','metadata-core.json.gz','metadata-detail.json.gz']:
            assert summary['input_receipts'][name]=={k:reference['source_assets'][name][k] for k in ['bytes','sha256']}
        priority=load(a.historical_root/'priority-candidates.json')['lake']
        with gzip.open(a.historical_root/'inventory.csv.gz','rt') as f:inventory=list(csv.DictReader(f))
        for rendered,e in zip(dst,EXPECTED):
            sid,fid,logical,index,count=e;aw='lakes_base:'+sid
            pr=[r for r in priority if r['aw_id']==aw]; ir=[r for r in inventory if r['aw_id']==aw]
            assert len(pr)==len(ir)==1
            assert pr[0]['geometry_fids']==[fid] and pr[0]['logical_fid']==int(ir[0]['logical_fid'])==logical
            assert pr[0]['source_id']==ir[0]['source_id']==sid
            assert pr[0]['bbox']==json.loads(ir[0]['bbox'])==[n/1e6 for n in rendered['properties']['bounds']]
            assert pr[0]['source_ids_sha256']==ir[0]['source_ids_sha256']==sha(sid.encode())
        historical_checks=[{'name':n,**record(a.historical_root/n)} for n in ['summary.json','priority-candidates.json','inventory.csv.gz']]
    originals=[]
    if a.local_originals:
        for s in load(root/'review/source-observations.json')['sources']:
            if s.get('local_path'):originals.append({'id':s['id'],**verify_file(Path(s['local_path']),s['content_receipt'])})
    print(json.dumps({'status':'passed','frozen_input_count':len(pins['files']),'geometry_records':checks,'total_positions_including_closure':sum(r['positions_including_closure'] for r in checks),'original_source_feature_equality_checked':bool(a.input_cache),'source_input_checks':source_input_checks,'historical_checks':historical_checks,'local_original_checks':originals,'complete_ogc_topology_test':False,'current_live_deployment_checked':False},indent=2))
if __name__=='__main__':main()
