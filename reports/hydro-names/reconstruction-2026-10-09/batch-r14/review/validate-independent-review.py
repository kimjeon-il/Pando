#!/usr/bin/env python3
"""Validate only included r14 facts and complete public-domain lake geometry."""
import argparse,hashlib,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
SOURCE_IDS=['1159108993','1159109007','1159108815']
AWIDS=['lakes_base:'+s for s in SOURCE_IDS]
FIDS=[15379,15380,15365];LOGICAL_FIDS=[4004,4005,3990];COUNTS=[43,31,62]
NAMES=['Grand Lake','White Lake','Lake Timiskaming / lac Témiscamingue']
CATEGORIES=['whole_polygon_scope_hold','supported_generalized_water_identity','source_limited_unresolved']
FORMS=[['Grand Lake'],['White Lake'],['Lake Timiskaming','lac Témiscamingue']]
ACCESS=[False,False,True];COMPLETED=[True,True,False];FOLLOW=[True,False,True]
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'
COLD='lakes_base:1159112821'
PRIOR_HOLDS=['lakes_base:1159109497','lakes_base:1159123531','lakes_base:1159123567','lakes_base:1159110371','lakes_base:1159109471','lakes_base:1159111751','lakes_base:1159112207','lakes_base:1159110475']
OBVT='https://obvt.ca/le-bassin-versant/le_plan_directeur_de_l_eau/les-sections-du-pde/portrait/'
ORRPB='https://www.ottawariver.ca/about-us/what-we-do/the-ottawa-river-basin-and-its-reservoirs/'
ORRPB_MAP='https://www.ottawariver.ca/wp-content/uploads/2019/02/Picture1.png'
CELCP='https://coast.noaa.gov/data/czm/landconservation/media/celcpplanlafinal.pdf'
CPRA='https://coastal.la.gov/wp-content/uploads/2023/04/CPRA_FY24-AP_20230418-compressed.pdf'
GROUPS={'white-grand':AWIDS[:2],'timiskaming':AWIDS[2:]}
GEOMETRY_FILES=['selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson']
RESEARCH_NAMES=['README.md','findings.json','source-evidence.json','target-identity-facts.json']
REVIEW_NAMES=['README.md','independent-review.json','public-input-pins.json','review-validation.json','source-observations.json','test-independent-review.py','validate-independent-review.py']

def require(condition,message):
    if not condition:raise ValueError(message)
def read(root,rel):return json.loads((root/rel).read_text())
def checked(root,rel,pin):
    path=root/rel
    require(not path.is_symlink() and path.is_file() and path.resolve().is_relative_to(root.resolve()),'Included regular file required: '+rel)
    data=path.read_bytes();require(hashlib.sha256(data).hexdigest()==pin['sha256'] and len(data)==pin['bytes'],'Included file integrity: '+rel)
def group_files(group):return RESEARCH_NAMES+['map-scope-review.json']
def input_files():
    return GEOMETRY_FILES+['geometry-reference.json','geometry-component-manifest.json']+[f'research/{g}/{n}' for g in GROUPS for n in group_files(g)+['research-manifest.json']]
def check_manifest(root,folder,name,expected,key):
    m=read(root,folder+'/'+name);rows=m['files']
    require(len(rows)==len(expected) and {x[key] for x in rows}==set(expected),'Included manifest file set')
    require(m['scope']=='included_public_files_only' and m['automatic_application'] is False,'Manifest public-only scope')
    for r in rows:checked(root,folder+'/'+r[key],r)
def check_integrity(root):
    p=read(root,'review/public-input-pins.json');expected=input_files()
    require(p['scope']=='included_public_files_only','Included input scope')
    require(len(p['files'])==len(expected) and {x['path'] for x in p['files']}==set(expected),'Exact included input set')
    for row in p['files']:checked(root,row['path'],row)
    for group in GROUPS:check_manifest(root,'research/'+group,'research-manifest.json',group_files(group),'path')
    check_manifest(root,'review','review-manifest.json',REVIEW_NAMES,'file')
    return len(expected)
def ring(g,n):
    require(g['type']=='Polygon' and len(g['coordinates'])==1,'Complete one-ring polygon')
    a=g['coordinates'][0];require(len(a)==n and a[0]==a[-1],'Complete ring length and closure')
    require(all(len(p)==2 and all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in p) and -180<=p[0]<=180 and -90<=p[1]<=90 for p in a),'Finite geographic positions')
    return a
def bbox(a):return [min(x[0] for x in a),min(x[1] for x in a),max(x[0] for x in a),max(x[1] for x in a)]
def check_geometry(root):
    src=read(root,GEOMETRY_FILES[0])['features'];dst=read(root,GEOMETRY_FILES[1])['features']
    require(len(src)==len(dst)==3,'All three complete geometries')
    ref=read(root,'geometry-reference.json');require(ref['baseline']['git_commit']==COMMIT and ref['scope_aw_ids']==AWIDS,'Fixed geometry reference')
    out=[]
    for i,(s,d) in enumerate(zip(src,dst)):
      require(s['id']==AWIDS[i] and d['id']==FIDS[i],'Distinct source and rendered ID domains')
      require(str(s['properties']['source_id'])==SOURCE_IDS[i] and s['properties']['pandolab_id']==AWIDS[i],'Original source identity')
      require(all(s['properties'][k]=='' for k in ['name_ko','name_en','name_original']),'Source language fields remain blank')
      bp=d['properties'];require((bp['sourceId'],bp['awId'],bp['fid'],bp['logicalFid'])==(SOURCE_IDS[i],AWIDS[i],FIDS[i],LOGICAL_FIDS[i]),'Rendered source, logical and feature ID join')
      a,b=ring(s['geometry'],COUNTS[i]),ring(d['geometry'],COUNTS[i]);require([[round(x,6) for x in p] for p in a]==b,'Every ordered source/baseline coordinate')
      require(bp['bounds']==[round(x*1000000) for x in bbox(b)],'Rendered bounds')
      out.append(dict(aw_id=AWIDS[i],source_id=SOURCE_IDS[i],geometry_fid=FIDS[i],logical_fid=LOGICAL_FIDS[i],position_count=COUNTS[i],every_ordered_position_checked=True,all_quantized_coordinates_match=True,source_bbox=bbox(a),baseline_bbox=bbox(b),maximum_coordinate_rounding_error_degrees=max(abs(x-y) for p,q in zip(a,b) for x,y in zip(p,q))))
    return out

def check_verdict(r):
 require(r['scope_aw_ids']==AWIDS and [f['aw_id'] for f in r['findings']]==AWIDS,'Review target order')
 require(r['baseline_commit']==COMMIT and (r['prior_distinct_targets'],r['current_batch_increment'],r['cumulative_distinct_targets'],r['duplicate_targets'])==(39,3,42,0),'Review baseline and counts')
 require(all(r[k] is False for k in ['automatic_application','geometry_modified','current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed']),'Closed application and prior-reassessment gates')
 require((r['scalar_product_name_approvals'],r['current_batch_full_feature_correspondence_reviews_completed'],r['current_batch_source_limited_targets'])==(0,2,1),'Recorded review totals')
 require(r['preserved_pending_access_ids']==[COLD] and r['preserved_scope_hold_ids']==PRIOR_HOLDS and r['new_scope_hold_ids']==AWIDS[:1] and r['new_pending_access_ids']==AWIDS[2:],'Distinct carried-forward and new pending/hold categories')
 h=r['historical_review'];require(h['available_source_inspection_completed'] is True and h['full_source_review_completed'] is False and h['original_source_material_included'] is False and h['historical_results_recomputed_by_public_validator'] is False and h['performed_at_utc']==r['reviewed_at_utc'],'Available-source inspection does not complete unavailable correspondence')
 for i,f in enumerate(r['findings']):
  require((f['source_id'],f['logical_fid'],f['geometry_fids'],f['position_count'],f['polygon_count'],f['ring_count'])==(SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],COUNTS[i],1,1),'Review geometry identity facts')
  require((f['candidate_name'],f['research_category'],f['source_research_category'])==(NAMES[i],CATEGORIES[i],CATEGORIES[i]),'Corrected names and bounded categories')
  require(f['source_access_limited'] is ACCESS[i] and f['full_feature_correspondence_review_completed'] is COMPLETED[i] and f['follow_up_required'] is FOLLOW[i],'Scope hold versus pending access')
  require(f['compound_named_waterbody_required_by_evidence'] is (False if i==1 else None),'No invented compound identity')
  require(f['directly_supported_name_forms']==FORMS[i],'Only directly documented forms')
  require(all(f[k] is False for k in ['automatic_application','scalar_product_name_approved','whole_polygon_name_application_cleared','formal_registry_verified','exact_shoreline_verified','label_overlap_alone_used_as_identity','freshwater_classification_verified','measured_salinity_verified']),'Closed product, registry and hydrologic gates')
  require(all(f[k] is None for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','name_en','name_original']),'No scalar or language promotion')
  require(f['actual_named_water_shapes_compared'] is COMPLETED[i] and f['source_and_rendered_ordered_coordinates_verified'] is True and f['complete_source_and_baseline_geometry_inspected'] is True,'Complete geometry versus complete named-water assessment')
  require(bool(f['water_context']) and bool(f['supported_name_scope']) and bool(f['limits']),'Bounded source interpretation')
 f=r['findings'][0];require(f['constituent_list_exhaustive'] is False and f['exact_name_partition_established'] is False and f['second_named_constituent_established'] is False,'Grand scope remains unresolved')
 f=r['findings'][2];require(f['formal_bilingual_equivalence_verified'] is False and f['whole_polygon_applicability_of_name_forms_verified'] is False,'Body usages are not a bilingual or polygon naming determination')

def check_research(root,review,geometry):
 source_lists=[]
 for group,ids in GROUPS.items():
  pre='research/'+group+'/';findings=read(root,pre+'findings.json');records=findings['records'];idx=[AWIDS.index(a) for a in ids]
  require([f['aw_id'] for f in records]==ids,'Research group identities')
  require((findings['target_count'],findings['new_actual_inventory_targets'],findings['full_feature_correspondence_review_completed_count'],findings['source_limited_unresolved_count'],findings['whole_feature_name_scope_hold_count'])==(len(ids),len(ids),sum(COMPLETED[i] for i in idx),sum(ACCESS[i] for i in idx),1 if group=='white-grand' else 0),'Research completion totals')
  require(findings['automatic_application'] is False and findings['product_application'] is False,'Research application disabled')
  for f,i in zip(records,idx):
   r=review['findings'][i]
   require(f['source_id']==SOURCE_IDS[i] and f['candidate_name']==NAMES[i] and f['directly_supported_name_forms']==FORMS[i],'Research source identity and documented usage')
   for k in ['research_category','source_access_limited','full_feature_correspondence_review_completed','follow_up_required','compound_named_waterbody_required_by_evidence','source_keys']:require(f[k]==r[k],'Research/review factual join: '+k)
   require(all(f[k] is False for k in ['automatic_application','product_application','formal_registry_verified','exact_shoreline_verified']) and f['whole_feature_scalar_name'] is None and f['korean_name'] is None and f['full_geometry_inspected'] is True,'Research closed gates')
  facts=read(root,pre+'target-identity-facts.json');require(facts['included_geometry_files']==GEOMETRY_FILES and [f['aw_id'] for f in facts['targets']]==ids,'Research included geometry linkage')
  for f,i in zip(facts['targets'],idx):
   g=geometry[i]
   require((f['source_id'],f['logical_fid'],f['baseline_fids'],f['source_geometry_type'],f['source_ring_count'],f['source_positions_including_closure'],f['source_interior_ring_count'])==(SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],'Polygon',1,COUNTS[i],0),'Complete research geometry facts')
   require(f['complete_ordered_source_baseline_match_at_six_decimals'] is True and f['geometry_modified'] is False and f['source_bbox']==g['source_bbox'] and f['inventory_bbox']==g['baseline_bbox'],'Ordered coordinate relation and bounds')
  ev=read(root,pre+'source-evidence.json');require(len(ev['sources'])==ev['independent_source_count']==2 and ev['independent_cartographic_identity_source_count']==(1 if group=='white-grand' else 0),'One Louisiana identity map, contextual Canadian map only')
  require(ev['automatic_application'] is False and ev['product_application'] is False and ev['search_snippets_used_as_identity_evidence'] is False,'Source evidence gates');source_lists.append(ev)
  scope=read(root,pre+'map-scope-review.json')['records'];require([x['aw_id'] for x in scope]==ids,'Map scope identities')
  for f,i in zip(scope,idx):
   require(f['complete_source_positions_considered']==f['complete_baseline_positions_considered']==COUNTS[i],'Full outline counts')
   require(f['source_access_limited'] is ACCESS[i] and f['full_feature_correspondence_review_completed'] is COMPLETED[i] and f['follow_up_required'] is FOLLOW[i],'Map scope completion distinction')
 la,ca=source_lists;cpra,celcp=la['sources'];obvt,orrpb=ca['sources']
 require(cpra['source_key']=='cpra_fy2024_plan' and cpra['url']==CPRA and cpra['edition']=='Fiscal Year 2024' and cpra['publication_date'] is None,'CPRA edition versus unverified calendar date')
 require([(p['physical_pdf_page'],p['printed_page']) for p in cpra['map_locations']]==[(28,'17'),(90,'79')],'CPRA actual map pages')
 require(celcp['source_key']=='louisiana_celcp2011' and celcp['url']==CELCP and celcp['publication_date']=='2011-05' and celcp['identity_map_evidence'] is False,'CELCP context role')
 require(all(s['retrieved_this_batch'] is False and s['original_map_visually_inspected'] is True for s in [cpra,celcp]) and la['new_source_requests_this_batch']==0 and la['unused_acquisition_outcomes']==[],'Prior originals reused, no new Louisiana requests')
 require(obvt['source_key']=='obvt_portrait_landing' and obvt['url']==OBVT and obvt['observed_name_forms']==['lac Témiscamingue'] and obvt['original_map_visually_inspected'] is False,'OBVT body usage only')
 require(orrpb['source_key']=='orrpb_reservoirs' and orrpb['url']==ORRPB and orrpb['map_url']==ORRPB_MAP and orrpb['observed_name_forms']==['Lake Timiskaming','Timiskaming'] and orrpb['original_map_visually_inspected'] is True,'ORRPB body and schematic')
 require(all(s['identity_map_evidence'] is False and s['body_inspected'] is True and s['retrieved_this_batch'] is True and s['publication_date'] is None for s in [obvt,orrpb]),'Contextual sources do not resolve feature or publication date')
 require(ca['inspected_contextual_map_publication_count']==1 and len(ca['unused_acquisition_outcomes'])==4,'Canadian source availability accounting')
 require(all(x['source_content_acquired'] is False and x['used_as_evidence'] is False for x in ca['unused_acquisition_outcomes']),'Unavailable originals excluded from evidence')

def check_observations(root):
 o=read(root,'review/source-observations.json')
 require(o['scope_aw_ids']==AWIDS and o['new_external_requests']==0 and o['distinct_acquired_publications']==4 and o['distinct_cartographic_identity_publications']==1 and o['inspected_contextual_map_publication_count']==2,'Observation source counts and scope')
 require(o['unused_unavailable_publications']==4 and o['shoreline_overlap_measured'] is False and o['survey_registration_verified'] is False,'Source interpretation limits')
 require([x['url'] for x in o['observations']]==[CPRA,CELCP,OBVT,ORRPB],'Bibliographic observation identities')
 require([x['aw_id'] for x in o['complete_geometry_observations']]==AWIDS and [x['position_count'] for x in o['complete_geometry_observations']]==COUNTS,'Complete geometry observations')
 for i,x in enumerate(o['complete_geometry_observations']):require(x['entire_source_and_baseline_geometry_viewed'] is True and x['whole_feature_map_scope_assessment_completed'] is COMPLETED[i],'Geometry inspection versus missing named-map coverage')

def validate_content(root):
 g=check_geometry(root);r=read(root,'review/independent-review.json');check_verdict(r);check_research(root,r,g);check_observations(root)
 return dict(status='passed',mode='included_public_files_only',scope_aw_ids=AWIDS,lake_geometry_checks=g,included_ordered_position_count=136,recorded_historical_full_feature_reviews_completed=2,current_source_limited_targets=1,current_pending_access_ids=AWIDS[2:],current_scope_hold_ids=AWIDS[:1],current_follow_up_ids=[AWIDS[0],AWIDS[2]],preserved_pending_access_ids=[COLD],preserved_scope_hold_ids=PRIOR_HOLDS,recorded_prior_target_count=39,current_batch_increment=3,recorded_cumulative_distinct_targets=42,distinct_acquired_publications=4,distinct_cartographic_identity_publications=1,original_source_material_reopened=False,map_judgments_reproduced=False,prior_target_source_or_geometry_reaudit_performed=False,formal_registry_verified=False,automatic_application=False,network_requests=0,limit='Included-file integrity and factual linkage only. Omitted publications and historical visual judgments are not reproduced; Timiskaming full-feature correspondence remains pending.')
def validate(root):
 root=Path(root);n=check_integrity(root);r=validate_content(root);r['public_input_files_checked']=n;r['included_component_manifests_checked']=3;return r
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=Path(__file__).resolve().parent.parent,help='Included package root');a=p.parse_args()
 try:r=validate(a.directory)
 except (ValueError,KeyError,TypeError,IndexError,OSError) as e:print(json.dumps(dict(status='failed',mode='included_public_files_only',error=str(e)),indent=2));return 1
 print(json.dumps(r,indent=2));return 0
if __name__=='__main__':sys.exit(main())
