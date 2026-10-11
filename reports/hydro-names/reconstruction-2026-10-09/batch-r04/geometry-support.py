"""Small offline helpers; no fetching, repair, simplification or coordinate reordering."""
import hashlib,json,math

def canonical(x):
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def sha(b):
    return hashlib.sha256(b).hexdigest()

def receipt(p):
    b=p.read_bytes()
    return {'bytes':len(b),'sha256':sha(b)}

def verified(p,r):
    assert receipt(p)=={k:r[k] for k in ['bytes','sha256']},p.name
    return p.read_bytes()

def polygon_parts(g):
    assert g['type'] in ['Polygon','MultiPolygon']
    return [g['coordinates']] if g['type']=='Polygon' else g['coordinates']

def line_parts(g):
    assert g['type'] in ['LineString','MultiLineString']
    return [g['coordinates']] if g['type']=='LineString' else g['coordinates']

def bounds(xy):
    assert xy
    for p in xy:
        assert len(p)==2 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in p)
        assert -180<=p[0]<=180 and -90<=p[1]<=90
    return [min(p[0] for p in xy),min(p[1] for p in xy),max(p[0] for p in xy),max(p[1] for p in xy)]

def lake_metrics(g):
    pp=polygon_parts(g);xy=[v for p in pp for r in p for v in r]
    assert all(p and all(len(r)>=4 and r[0]==r[-1] for r in p) for p in pp)
    return {'type':g['type'],'polygon_part_count':len(pp),'ring_counts_by_part':[len(p) for p in pp],'coordinate_counts_by_part_and_ring':[[len(r) for r in p] for p in pp],'total_coordinates_including_closure':len(xy),'bbox':bounds(xy),'all_rings_closed':True,'canonical_geometry_sha256':sha(canonical(g))}

def river_metrics(g):
    pp=line_parts(g);xy=[v for p in pp for v in p]
    assert all(len(p)>=2 for p in pp)
    return {'type':g['type'],'part_count':len(pp),'coordinate_counts_by_part':[len(p) for p in pp],'coordinate_count':len(xy),'bounds':bounds(xy),'fragment_endpoints':[pp[0][0],pp[-1][-1]],'canonical_geometry_sha256':sha(canonical(g)),'coordinate_order':'Exact production decoder part and vertex order; no simplification, sorting, repair or reversal.'}

def source_features(raw,ids):
    text=raw.decode('utf-8');decoder=json.JSONDecoder();pos=text.index('[',text.index('"features"'))+1;found={};index=0
    while True:
        while text[pos].isspace() or text[pos]==',':pos+=1
        if text[pos]==']':break
        feature,end=decoder.raw_decode(text,pos);ident=str(feature['properties']['source_id'])
        if ident in ids:
            assert ident not in found
            found[ident]=(index,feature,text[pos:end].encode('utf-8'))
        index+=1;pos=end
    assert set(found)==set(ids)
    return found
