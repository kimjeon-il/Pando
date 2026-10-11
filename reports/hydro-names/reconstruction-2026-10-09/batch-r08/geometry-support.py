"""Original offline factual geometry helpers; no source data or external access."""
import hashlib,json,math

def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def receipt(p):
 b=p.read_bytes();return {'bytes':len(b),'sha256':sha(b)}
def verified(p,r):
 b=p.read_bytes();assert len(b)==r['bytes'] and sha(b)==r['sha256'],p.name
 if 'git_blob_sha' in r:assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==r['git_blob_sha'],p.name
 return b
def name_fields(m):return {k:v for k,v in m.items() if k=='name' or k.startswith('name_') or k in ['nameKo','nameEn','nameOriginal','mainstemNameKo']}
def parts(g):
 assert g['type'] in ['LineString','MultiLineString'],'river geometry type'
 return [g['coordinates']] if g['type']=='LineString' else g['coordinates']
def metrics(g):
 pp=parts(g);xy=[v for p in pp for v in p];assert pp and all(len(p)>=2 for p in pp)
 for p in xy:assert len(p)==2 and all(math.isfinite(v) for v in p) and -180<=p[0]<=180 and -90<=p[1]<=90
 return {'type':g['type'],'part_count':len(pp),'coordinate_count':len(xy),'coordinate_counts_by_part':[len(p) for p in pp],'ordered_parts':[{'part_index':i,'coordinate_count':len(p),'ordered_coordinate_sha256':sha(canonical(p))} for i,p in enumerate(pp)],'bounds':[min(p[0] for p in xy),min(p[1] for p in xy),max(p[0] for p in xy),max(p[1] for p in xy)],'fragment_endpoints':[pp[0][0],pp[-1][-1]],'canonical_geometry_sha256':sha(canonical(g)),'coordinate_order':'Exact production decoder part and vertex order; no simplification, sorting, repair or reversal.'}
def terminal_facts(m,g):
 t=m.get('terminal')
 if not t:return None
 end=parts(g)[-1][-1];quant=[round(v,6) for v in t['renderEndpoint']]
 return {'class':t['class'],'source_endpoint':t['sourceEndpoint'],'render_endpoint_before_quantization':t['renderEndpoint'],'render_endpoint_quantized':quant,'source_endpoint_equals_render_endpoint':t['sourceEndpoint']==t['renderEndpoint'],'decoded_last_vertex_matches_render_endpoint_quantized':end==quant,'meaning':'Source endpoint means the retained baseline metadata value, not a coordinate independently obtained from original HydroRIVERS source geometry.'}
