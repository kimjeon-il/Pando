#!/usr/bin/env python3
"""Read-only 5.1.1 administrative Papuan island component audit.

Uses Natural Earth 5.1.1 Admin-1 geometry to identify *all* West New Guinea
island components in the original canonical Indonesian national polygon.
No source file is changed by this script.
"""
import json
import pathlib
import urllib.request
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT=pathlib.Path(__file__).resolve().parents[1]
URL='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_10m_admin_1_states_provinces.geojson'
data=json.loads((ROOT/'assets/data/territorial-entities/source/countries/state-IDN.json').read_text(encoding='utf-8'))
entity=next(e for e in [data] if e['entityId']=='state:IDN')
modern=next(v for v in entity['geometryVersions'] if v['versionId']=='state:IDN:natural-earth-5.1.1')
request=urllib.request.Request(URL,headers={'User-Agent':'Pando historical atlas research (Natural Earth 5.1.1)'})
with urllib.request.urlopen(request,timeout=180) as response:
    admin=json.load(response)
is_indonesian=lambda p: str(p.get('admin') or p.get('geonunit') or p.get('sovereignt') or '').lower()=='indonesia'
regions=[]
for f in admin['features']:
 p=f['properties']
 if not is_indonesian(p):
  continue
 name=str(p.get('name_en') or p.get('name') or '')
 iso=str(p.get('iso_3166_2') or '')
 if 'papua' in name.lower() or 'irian' in name.lower() or iso in ('ID-PA','ID-PB','ID-PS','ID-PE','ID-PT','ID-PD'):
  regions.append((name,iso,shape(f['geometry'])))
print('SOURCE',URL)
print('REGIONS',[(n,i,round(g.area,3),len(g.geoms) if hasattr(g,'geoms') else 1) for n,i,g in regions])
if not regions: raise RuntimeError('No Papuan provinces: inspect property filter')
papua=unary_union([g for _,_,g in regions])
countries=modern['geometry']['coordinates']
print('POLYGONS',len(countries))
selected=[];nearby=[]
for i,poly in enumerate(countries):
 g=shape({'type':'Polygon','coordinates':poly})
 if g.bounds[2]<127.3 or g.bounds[1]>3 or g.bounds[3]<-11: continue
 intersection=g.intersection(papua)
 fraction=intersection.area/g.area if g.area else 0
 rep=g.representative_point()
 inside=papua.covers(rep)
 row=(i,round(fraction,5),inside,tuple(round(x,4) for x in g.bounds),round(g.area,5))
 nearby.append(row)
 if fraction>=0.5 or inside:selected.append(i)
print('SELECTED',selected)
print('SUMMARY',len(selected),len(nearby))
for item in nearby:print('POLY',*item)
