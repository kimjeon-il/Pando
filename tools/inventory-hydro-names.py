#!/usr/bin/env python3
"""Read-only audit of verified deployed hydro metadata; never edits product data.
Inputs are saved deployment files. Decode geometry using decode-hydro-connectivity.mjs.
"""
import argparse, collections, csv, gzip, hashlib, json, math, pathlib, re

PLACEHOLDER = re.compile(r'^(?:미명명\s*수계(?:\s*\d+)?|(?:river|lake)[-_ ]?\d+|이름\s*없는\s*(?:강|호수)|\d+)$', re.I)
def meaningful(value):
    value = str(value or '').strip()
    return bool(value and not PLACEHOLDER.fullmatch(value))
def digest(data): return hashlib.sha256(data).hexdigest()
def length_km(geometry):
    lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
    total = 0
    for line in lines:
        for (x,y),(xx,yy) in zip(line,line[1:]):
            dy,dx=math.radians(yy-y),math.radians(xx-x)
            a=math.sin(dy/2)**2+math.cos(math.radians(y))*math.cos(math.radians(yy))*math.sin(dx/2)**2
            total += 12742.0176*math.asin(min(1,math.sqrt(a)))
    return total
def area_km2(geometry):
    polygons=[geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates']
    def ring_area(ring):
        total=0
        for (x,y),(xx,yy) in zip(ring,ring[1:]+ring[:1]):
            dx=(math.radians(xx-x)+math.pi)%(2*math.pi)-math.pi
            total+=dx*(2+math.sin(math.radians(y))+math.sin(math.radians(yy)))
        return abs(total)*6371.0088**2/2
    return sum(max(0,ring_area(p[0])-sum(ring_area(r) for r in p[1:])) for p in polygons)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    parser.add_argument('--baseline-sha',required=True)
    args=parser.parse_args(); p=args.input; out=args.output
    if 'assets' in out.parts: raise ValueError('Research output cannot be under product assets')
    manifest=json.loads((p/'deployed-manifest.json').read_text()); receipts={}
    def verified(name,spec=None):
        b=(p/name).read_bytes(); receipts[name]={'bytes':len(b),'sha256':digest(b)}
        if spec:
            assert len(b)==spec.get('bytes',len(b)) and digest(b)==spec['sha256'],name
        return b
    core=json.loads(gzip.decompress(verified('metadata-core.json.gz',manifest['metadata']['core'])))['features']
    detail=json.loads(gzip.decompress(verified('metadata-detail.json.gz',manifest['metadata']['detail'])))['features']
    assert len(core)==len(detail)==manifest['metadata']['featureCount']
    details={r['fid']:r for r in detail}; assert len(details)==len(detail)
    sources={r['file']:r for r in manifest['sources']['naturalEarthNameReference']}
    lakes=json.loads(verified('lakes_base.geojson',sources['lakes_base.geojson']))['features']
    ne_rivers=json.loads(verified('rivers_base.geojson',sources['rivers_base.geojson']))['features']
    lake_by_id={str(r['properties']['source_id']):r['properties'] for r in lakes}
    decoded=json.loads((p/'decoded.json').read_text())
    assert decoded['manifest']==manifest
    geometry={r['metadata']['fid']:r for r in decoded['features']}
    assert len(geometry)==len(core)
    grouped=collections.defaultdict(list)
    for row in core:
        assert row['fid'] in details and geometry[row['fid']]['metadata']==row|details[row['fid']]
        grouped[row['awId']].append(row|details[row['fid']])
    output=[]
    for aw_id,rows in sorted(grouped.items()):
        first=rows[0]; kind=first['category']; fids=[r['fid'] for r in rows]
        assert len({r['logicalFid'] for r in rows})==1
        names=sorted({r['name'] for r in rows if r.get('name')}); aliases=sorted({n for r in rows for n in r.get('aliases',[]) if meaningful(n)})
        tributary=sorted({n for r in rows for n in r.get('tributaryNames',[]) if meaningful(n)})
        proper=any(meaningful(n) for n in names)
        canonical=lake_by_id[str(first['sourceId'])] if kind=='lake' else {}
        canonical_names={k:v for k,v in canonical.items() if k.startswith('name')}
        named_evidence=any(meaningful(n) for n in [*names,*aliases,*tributary,*canonical_names.values()])
        classification=('named_display' if proper else 'placeholder_with_related_name_evidence' if named_evidence else 'no_meaningful_name_in_deployed_data')
        bounds=[min(r['bounds'][i] for r in rows)/1e6 for i in (0,1)]+[max(r['bounds'][i] for r in rows)/1e6 for i in (2,3)]
        reach_ids=sorted({s for r in rows for s in r['sourceId'].split(',')})
        metrics={'rendered_network_length_km':None,'rendered_mainstem_length_km':None,'rendered_area_km2':None}
        if kind=='river':
            metrics['rendered_network_length_km']=round(sum(length_km(geometry[f]['geometry']) for f in fids),3)
            metrics['rendered_mainstem_length_km']=round(sum(length_km(geometry[r['fid']]['geometry']) for r in rows if r.get('role')=='mainstem'),3)
        else: metrics['rendered_area_km2']=round(sum(area_km2(geometry[f]['geometry']) for f in fids),3)
        output.append({'aw_id':aw_id,'category':kind,'system_id':first.get('systemId'),'logical_fid':first['logicalFid'],'geometry_fids':fids,'geometry_count':len(rows),'display_names':names,'classification':classification,'has_korean_display':any(meaningful(n) and re.search('[가-힣]',n) for n in names),'aliases':aliases,'tributary_names':tributary,'osm_relation_ids':sorted({v for r in rows for v in r.get('osmRelationIds',[])}),'bbox':bounds,'center':[round((bounds[0]+bounds[2])/2,6),round((bounds[1]+bounds[3])/2,6)],'minimum_stage':min(r['stage'] for r in rows),'source_ids_count':len(reach_ids),'source_id':first['sourceId'] if kind=='lake' else None,'source_ids_sha256':digest(','.join(reach_ids).encode()),'source_ids_locator':'metadata-detail.json.gz features[fid in geometry_fids].sourceId','sources':sorted({r['source'] for r in rows}),'canonical_name_fields':canonical_names,'wikidata_id':canonical.get('wikidata_id') or None,'feature_class':canonical.get('feature_class') or None,**metrics})
    out.mkdir(parents=True,exist_ok=True)
    def write_json(name,data): (out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    write_json('inventory.json',output)
    keys=['aw_id','category','system_id','logical_fid','geometry_count','classification','display_names','has_korean_display','bbox','minimum_stage','source_id','source_ids_count','source_ids_sha256','rendered_mainstem_length_km','rendered_network_length_km','rendered_area_km2','wikidata_id']
    with (out/'inventory.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=keys);writer.writeheader()
        for r in output:writer.writerow({k:json.dumps(r[k],ensure_ascii=False) if isinstance(r[k],list) else r[k] for k in keys})
    for name in ['inventory.json', 'inventory.csv']:
        (out/(name+'.gz')).write_bytes(gzip.compress((out/name).read_bytes(), mtime=0))
    priorities={kind:sorted([r for r in output if r['category']==kind and r['classification']!='named_display'],key=lambda r:-(r[metric] or 0))[:30] for kind,metric in [('river','rendered_mainstem_length_km'),('lake','rendered_area_km2')]}
    write_json('priority-candidates.json',priorities)
    summary={'baseline_sha':args.baseline_sha,'deployment_url':'https://kimjeon-il.github.io/Pando/','build_meta':(p/'deployed-build-meta.js').read_text(),'manifest_sha256':digest((p/'deployed-manifest.json').read_bytes()),'main_manifest_equal':(p/'main-manifest.json').read_bytes()==(p/'deployed-manifest.json').read_bytes(),'input_receipts':receipts,'geometry_feature_count':len(core),'logical_object_count':len(output),'counts':{kind:dict(collections.Counter(r['classification'] for r in output if r['category']==kind)) for kind in ['river','lake']},'river_name_categories':dict(collections.Counter('explicit_unnamed' if r['display_names'][0].startswith('미명명') else 'numeric_placeholder' if not meaningful(r['display_names'][0]) else 'meaningful' for r in output if r['category']=='river')),'manifest_stats':manifest['stats'],'related_name_review_ids':[r['aw_id'] for r in output if r['classification']=='placeholder_with_related_name_evidence'],'unnamed_by_minimum_stage':{kind:dict(collections.Counter(r['minimum_stage'] for r in output if r['category']==kind and r['classification']!='named_display')) for kind in ['river','lake']},'natural_earth_reference_counts':{'lake_features':len(lakes),'river_geometry_features':len(ne_rivers),'river_unique_ids':len({r['properties']['pandolab_id'] for r in ne_rivers})},'limits':['MAIN_RIV logical groups are not counts of individually named rivers.','No absence claim about names outside deployed data. Related/tributary names are not approved mainstem names.','Length/area use rendered, potentially border-aligned geometry and spherical approximations, not official metrics.','Source reach IDs retained by exact verified detail hash plus FID locators, not copied into each report.','Named-display cases are static metadata evidence; no browser visibility conclusion.']}
    write_json('summary.json',summary)
    print(json.dumps({k:summary[k] for k in ['geometry_feature_count','logical_object_count','counts','river_name_categories','related_name_review_ids','unnamed_by_minimum_stage']},ensure_ascii=False))
if __name__=='__main__': main()
