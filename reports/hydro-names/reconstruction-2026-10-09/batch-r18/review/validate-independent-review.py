#!/usr/bin/env python3
"""Validate only included r18 facts and complete public-domain lake geometry."""
import argparse,hashlib,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
SOURCE_IDS=['1159116675','1159118183','1159118201']
AWIDS=['lakes_base:'+s for s in SOURCE_IDS]
FIDS=[15858,15945,15946];LOGICAL_FIDS=[4483,4570,4571];COUNTS=[38,58,24]
SOURCE_INDICES=[665,752,753]
NAMES=['Lake Ohrid','Prespa Lake',None]
CATEGORIES=['candidate_waterbody_identity_extent_hold','candidate_waterbody_identity_extent_hold','whole_polygon_scope_hold']
FORMS=[[],[],[]]
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR_PENDING=['lakes_base:1159112821','lakes_base:1159108815']
PRIOR_HOLDS=['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207', 'lakes_base:1159110475', 'lakes_base:1159108993', 'lakes_base:1159109803', 'lakes_base:1159108469', 'lakes_base:1159108703', 'lakes_base:1159109993', 'lakes_base:1159110087']
SOURCE_KEYS=[['pont_prespa_ohrid_general_map']]*3
PONT='https://www.pont.org/wp-content/uploads/2021/11/General-Map.pdf'
GEOMETRY_FILES=['selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson']
GEOMETRY_COMPONENT_FILES=['geometry-support.py','selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json']
RESEARCH_NAMES=['README.md','findings.json','source-evidence.json','target-identity-facts.json','map-scope-review.json']
REVIEW_NAMES=['README.md','independent-review.json','public-input-pins.json','review-validation.json','source-observations.json','test-independent-review.py','validate-independent-review.py']

def require(condition,message):
 if not condition:raise ValueError(message)
def read(root,rel):return json.loads((root/rel).read_text())
def checked(root,rel,pin):
 path=root/rel
 require(not path.is_symlink() and path.is_file() and path.resolve().is_relative_to(root.resolve()),'Included regular file required: '+rel)
 data=path.read_bytes();require(hashlib.sha256(data).hexdigest()==pin['sha256'] and len(data)==pin['bytes'],'Included file integrity: '+rel)
def input_files():return GEOMETRY_COMPONENT_FILES+['geometry-component-manifest.json']+['research/balkan/'+n for n in RESEARCH_NAMES+['research-manifest.json']]
def check_manifest(root,folder,name,expected,key):
 m=read(root,folder+'/'+name);rows=m['files']
 require(len(rows)==len(expected) and {x[key] for x in rows}==set(expected),'Included manifest file set')
 require(m['scope']=='included_public_files_only' and m['automatic_application'] is False,'Manifest public-only scope')
 for row in rows:checked(root,folder+'/'+row[key],row)
def check_integrity(root):
 p=read(root,'review/public-input-pins.json');expected=input_files()
 require(p['scope']=='included_public_files_only' and p['batch']=='r18','Included input scope')
 require(len(p['files'])==len(expected) and {x['path'] for x in p['files']}==set(expected),'Exact included input set')
 for row in p['files']:checked(root,row['path'],row)
 m=read(root,'geometry-component-manifest.json');require(m['scope_aw_ids']==AWIDS and set(m['files'])==set(GEOMETRY_COMPONENT_FILES),'Exact geometry component set')
 for n,h in m['files'].items():require(hashlib.sha256((root/n).read_bytes()).hexdigest()==h,'Geometry component integrity')
 check_manifest(root,'research/balkan','research-manifest.json',RESEARCH_NAMES,'path')
 check_manifest(root,'review','review-manifest.json',REVIEW_NAMES,'file')
 return len(expected)
def ring(g,n):
 require(g['type']=='Polygon' and len(g['coordinates'])==1,'Complete one-ring polygon')
 a=g['coordinates'][0];require(len(a)==n and a[0]==a[-1],'Complete ring length and closure')
 require(all(len(p)==2 and all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in p) and -180<=p[0]<=180 and -90<=p[1]<=90 for p in a),'Finite geographic positions')
 return a
def bbox(a):return [min(x[0] for x in a),min(x[1] for x in a),max(x[0] for x in a),max(x[1] for x in a)]
def check_geometry(root):
 src=read(root,GEOMETRY_FILES[0])['features'];dst=read(root,GEOMETRY_FILES[1])['features'];inv=read(root,'selected-inventory-records.json')['records']
 require(len(src)==len(dst)==len(inv)==3,'All three complete geometries')
 ref=read(root,'geometry-reference.json');require(ref['baseline']['git_commit']==COMMIT and ref['scope_aw_ids']==AWIDS,'Fixed geometry reference')
 out=[]
 for i,(s,d,row) in enumerate(zip(src,dst,inv)):
  require(s['id']==AWIDS[i] and d['id']==FIDS[i],'Distinct source and rendered ID domains')
  require(str(s['properties']['source_id'])==SOURCE_IDS[i] and s['properties']['pandolab_id']==AWIDS[i],'Original source identity')
  require(all(s['properties'][k]=='' for k in ['name_ko','name_en','name_original']),'Source language fields remain blank')
  bp=d['properties'];require((bp['sourceId'],bp['awId'],bp['fid'],bp['logicalFid'])==(SOURCE_IDS[i],AWIDS[i],FIDS[i],LOGICAL_FIDS[i]),'Rendered source, logical and feature ID join')
  a,b=ring(s['geometry'],COUNTS[i]),ring(d['geometry'],COUNTS[i]);require([[round(x,6) for x in p] for p in a]==b,'Every ordered source/baseline coordinate')
  require(bp['bounds']==[round(x*1000000) for x in bbox(b)],'Rendered bounds')
  require((row['aw_id'],row['source_id'],row['logical_fid'],row['geometry_fids'],row['bbox'])==(AWIDS[i],SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],bbox(b)),'Included inventory identity and bounds')
  rf=ref['selected_features'][i];require((rf['source_id'],rf['aw_id'],rf['baseline_fid'],rf['baseline_logical_fid'])==(SOURCE_IDS[i],AWIDS[i],FIDS[i],LOGICAL_FIDS[i]),'Reference identity join')
  require(rf['source_feature_zero_based_index']==SOURCE_INDICES[i],'Original source feature index fact')
  require(rf['baseline_metadata_exact']==bp,'Reference complete baseline facts')
  out.append(dict(aw_id=AWIDS[i],source_id=SOURCE_IDS[i],geometry_fid=FIDS[i],logical_fid=LOGICAL_FIDS[i],position_count=COUNTS[i],every_ordered_position_checked=True,all_quantized_coordinates_match=True,source_bbox=bbox(a),baseline_bbox=bbox(b),maximum_coordinate_rounding_error_degrees=max(abs(x-y) for p,q in zip(a,b) for x,y in zip(p,q))))
 return out

def check_verdict(r):
 require(r['scope_aw_ids']==AWIDS and [f['aw_id'] for f in r['findings']]==AWIDS,'Review target order')
 require(r['baseline_commit']==COMMIT and (r['prior_distinct_targets'],r['current_batch_increment'],r['cumulative_distinct_targets'],r['duplicate_targets'])==(51,3,54,0),'Review baseline and counts')
 require(all(r[k] is False for k in ['automatic_application','geometry_modified','current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed']),'Closed application and prior-reassessment gates')
 require((r['scalar_product_name_approvals'],r['current_batch_full_feature_correspondence_reviews_completed'],r['current_batch_source_limited_targets'])==(0,3,0),'Recorded review totals')
 require(r['preserved_pending_access_ids']==PRIOR_PENDING and r['preserved_scope_hold_ids']==PRIOR_HOLDS and r['new_scope_hold_ids']==AWIDS and r['new_pending_access_ids']==[],'Distinct carried-forward pending and scope-hold categories')
 h=r['historical_review'];require(h['available_source_inspection_completed'] is True and h['full_source_review_completed'] is True and h['original_source_material_included'] is False and h['historical_results_recomputed_by_public_validator'] is False and h['performed_at_utc']==r['reviewed_at_utc'],'Recorded source inspection versus public validation')
 for i,f in enumerate(r['findings']):
  require((f['source_id'],f['logical_fid'],f['geometry_fids'],f['position_count'],f['polygon_count'],f['ring_count'])==(SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],COUNTS[i],1,1),'Review geometry identity facts')
  require((f['candidate_name'],f['research_category'],f['source_research_category'])==(NAMES[i],CATEGORIES[i],CATEGORIES[i]),'Bounded names and categories')
  require(f['source_access_limited'] is False and f['full_feature_correspondence_review_completed'] is True and f['follow_up_required'] is True,'Completed scope hold versus pending access')
  require(f['compound_named_waterbody_required_by_evidence'] is None,'No invented compound identity')
  require(f['directly_supported_name_forms']==FORMS[i],'Only directly documented forms')
  require(all(f[k] is False for k in ['automatic_application','scalar_product_name_approved','whole_polygon_name_application_cleared','formal_registry_verified','exact_shoreline_verified','whole_named_water_extent_verified','label_overlap_alone_used_as_identity']),'Closed product, registry and survey gates')
  require(all(f[k] is None for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','name_en','name_original']),'No scalar or language promotion')
  require(f['actual_mapped_water_shapes_compared'] is True and f['source_and_rendered_ordered_coordinates_verified'] is True and f['complete_source_and_baseline_geometry_inspected'] is True,'Complete geometry and full map assessment')
  require(bool(f['supported_name_scope']) and bool(f['limits']) and f['source_keys']==SOURCE_KEYS[i],'Bounded source interpretation')
  require(f['confidence']['formal_naming_authority_verified'] is False and f['confidence']['numerical_probability_claimed'] is False and f['confidence']['whole_feature_name_association']==('low' if i<2 else 'not established'),'Bounded single-source name confidence')
 for i,f in enumerate(r['findings']):
  require(f['constituent_list_exhaustive'] is False and f['exact_name_partition_established'] is False and f['second_named_constituent_established'] is False,'Unresolved naming scope')
  require(f['contextual_label_promoted_to_target_name'] is False and f['settlement_label_promoted_to_water_name'] is False,'Nearby lake and settlement labels not promoted')
  require(f['candidate_name_role']==('geographic_candidate_only_extent_hold' if i<2 else 'unassigned_after_complete_scope_review') and bool(f['unassigned_region']) and bool(f['follow_up_scope']),'Association versus null target name preserves scope')
  require(all(f[k] is False for k in ['conservation_designation_promoted_to_whole_water_name','site_boundary_treated_as_shoreline','source_publisher_is_government_naming_authority']),'Conservation source and designation limits')
  if i<2:require(f['observed_name_wording']==[NAMES[i]] and f['geometry_repair_required_by_this_hold'] is False and bool(f['observed_name_wording_scope']) and bool(f['hold_scope']),'Literal candidate wording and naming-only hold')
 c=r['inherited_scope_continuity'];require(c['aw_id']=='lakes_base:1159109723' and c['candidate_name']=='Sandfly Lake' and c['selected_scope']=='eastern basin' and c['whole_named_water_extent_equivalence_claimed'] is False and c['connecting_river_name_extension_approved'] is False and c['prior_source_geometry_reaudit_performed'] is False,'Inherited Sandfly eastern-basin scope retained without re-audit')

 require(c['supported_name_scope']=='The complete eastern basin corresponds at regional scale to water beneath the Lake part of the Sandfly Lake label. Its broad northern cap, western notch, eastern indentation and lower eastward arm taper into the southern tip. The full outline was compared with mapped water and surrounding shore. This supports generalized Sandfly Lake association for the selected feature, not equivalence with the entire named lake or extension of that name to connecting river water.' and r['scope_continuity_enrichments']==[{'aw_id': 'lakes_base:1159109723', 'field': 'supported_name_scope', 'value': 'The complete eastern basin corresponds at regional scale to water beneath the Lake part of the Sandfly Lake label. Its broad northern cap, western notch, eastern indentation and lower eastward arm taper into the southern tip. The full outline was compared with mapped water and surrounding shore. This supports generalized Sandfly Lake association for the selected feature, not equivalence with the entire named lake or extension of that name to connecting river water.', 'reason': 'Preserve the eastern-basin limitation explicitly in the compact cumulative record. The prior public result already contains this wording; no naming decision is changed.', 'source_commit': '9c7301187854cf95bc7751eaee95e129d53259b0', 'source_repository_path': 'reports/hydro-names/reconstruction-2026-10-09/batch-r16/results.json', 'source_url': 'https://github.com/kimjeon-il/Pando/blob/9c7301187854cf95bc7751eaee95e129d53259b0/reports/hydro-names/reconstruction-2026-10-09/batch-r16/results.json', 'source_sha256': 'acd2dc6a1e2b4febd1a196240712dca536069f8c2b058c98d8ceb7c3fd8bd83c', 'source_scope': 'Already published factual result, not an omitted original source or private derivative.'}],'Exact published eastern-basin scope and enrichment retained')

def check_research(root,review,geometry):
 pre='research/balkan/';f=read(root,pre+'findings.json');rows=f['records']
 require([r['aw_id'] for r in rows]==AWIDS,'Research order')
 require((f['target_count'],f['new_actual_inventory_targets'],f['full_feature_correspondence_review_completed_count'],f['source_limited_unresolved_count'],f['whole_feature_name_scope_hold_count'])==(3,3,3,0,1),'Research totals')
 require(f['candidate_waterbody_identity_extent_hold_count']==2 and f['naming_candidate_count']==2 and f['supported_generalized_water_identity_count']==0,'Two candidates with extent holds; no supported whole-water identities')
 require(f['automatic_application'] is False and f['product_application'] is False,'Research application disabled')
 for i,row in enumerate(rows):
  r=review['findings'][i]
  require(row['contextual_map_labels']==r['nearby_contextual_name_forms'],'Context labels linked without identity promotion')
  require(row['source_id']==SOURCE_IDS[i] and row['candidate_name']==NAMES[i] and row['directly_supported_name_forms']==FORMS[i],'Research identities and assigned forms')
  for key in ['research_category','source_access_limited','full_feature_correspondence_review_completed','follow_up_required','compound_named_waterbody_required_by_evidence','source_keys']:require(row[key]==r[key],'Research/review factual join: '+key)
  require(row['confidence']==r['confidence'] and row['follow_up_scope']==r['follow_up_scope'],'Exact research confidence and follow-up scope retained')
  if i<2:
   for key in ['observed_name_wording','observed_name_wording_scope','geometry_repair_required_by_this_hold','hold_scope']:require(row[key]==r[key],'Exact candidate-evidence and hold linkage: '+key)
  require(all(row[k] is False for k in ['automatic_application','product_application','formal_registry_verified','exact_shoreline_verified']) and row['whole_feature_scalar_name'] is None and row['korean_name'] is None and row['full_geometry_inspected'] is True,'Research closed gates')
  require(row['whole_named_lake_extent_equivalence_claimed'] is False and row['exact_name_partition_established'] is False and row['confidence']['formal_naming_authority_verified'] is False,'Research naming-extent and authority limits')
 facts=read(root,pre+'target-identity-facts.json');require(facts['included_geometry_files']==GEOMETRY_FILES and [f['aw_id'] for f in facts['targets']]==AWIDS,'Research geometry linkage')
 for i,row in enumerate(facts['targets']):
  g=geometry[i]
  require((row['source_id'],row['logical_fid'],row['baseline_fids'],row['source_geometry_type'],row['source_ring_count'],row['source_positions_including_closure'],row['source_interior_ring_count'])==(SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],'Polygon',1,COUNTS[i],0),'Research full geometry facts')
  require(row['complete_ordered_source_baseline_match_at_six_decimals'] is True and row['geometry_modified'] is False and row['source_bbox']==g['source_bbox'] and row['inventory_bbox']==g['baseline_bbox'],'Research ordered coordinates and bounds')
 ev=read(root,pre+'source-evidence.json');require(len(ev['sources'])==ev['distinct_publication_count']==1 and ev['independent_source_count']==ev['independent_cartographic_identity_source_count']==1,'One conservation publication, no multiplied independence')
 require(ev['automatic_application'] is False and ev['product_application'] is False and ev['search_snippets_used_as_identity_evidence'] is False,'Source evidence gates')
 s=ev['sources'][0];require(s['source_key']==SOURCE_KEYS[0][0] and s['url']==PONT and s['publication_date'] is None,'PONT bibliography and unresolved publication date')
 require(s['retrieved_this_batch'] is True and s['original_map_visually_inspected'] is True,'Existing original map inspected')
 require(s['kind']=='conservation_trust_thematic_map' and ev['formal_government_naming_source_count']==0 and 'not a governmental naming authority' in s['publisher_authority_scope'],'Conservation trust is not a formal naming authority')
 require(len(ev['unused_acquisition_outcomes'])==4,'Four unused auxiliary publication outcomes')
 for a in ev['unused_acquisition_outcomes']:require(a['original_bytes_acquired'] is False and a['used_as_visual_map_evidence'] is False,'Failed auxiliary source supplies no identity evidence')
 scope=read(root,pre+'map-scope-review.json')['records'];require([x['aw_id'] for x in scope]==AWIDS,'Map scope identities')
 for i,row in enumerate(scope):
  require(row['complete_source_positions_considered']==row['complete_baseline_positions_considered']==COUNTS[i],'Full outline counts')
  require(row['source_access_limited'] is False and row['full_feature_correspondence_review_completed'] is True and row['follow_up_required'] is True,'Map scope completion distinction')

def check_prior_delta(root):
 d=read(root,'geometry-duplicate-check.json');old=d['previous_aw_ids_in_index_order']
 require(len(old)==len(set(old))==d['previous_target_count']==51 and not set(old)&set(AWIDS),'Prior membership and current unique delta')
 require(d['selected_aw_ids']==AWIDS and d['intersection_aw_ids']==[] and len(set(old+AWIDS))==54,'Distinct current order and cumulative54')
 require(d['preserved_pending_access_ids']==PRIOR_PENDING and d['preserved_scope_hold_ids']==PRIOR_HOLDS,'Carried flags')
 x=d['current_batch_delta'];require((x['initial_eligible_target_count'],x['reconstructed_target_count_before'],x['reconstructed_target_count_after'],x['remaining_fresh_reconstruction_queue_before'],x['remaining_fresh_reconstruction_queue_after'])==(4065,51,54,4014,4011),'Included arithmetic')
 require(x['remaining_queue_types_after']=={'river_group':3439,'lake':572} and x['prior_target_geometry_or_naming_revalidation_performed'] is False and x['historically_never_reviewed_count_claimed'] is False,'Queue type delta and no history reaudit')

def check_observations(root):
 o=read(root,'review/source-observations.json')
 require(o['scope_aw_ids']==AWIDS and o['new_external_requests']==0 and o['distinct_acquired_publications']==o['distinct_cartographic_identity_publications']==o['independent_source_groups']==1,'Observation counts and scope')
 require(all(o[k] is False for k in ['shoreline_overlap_measured','survey_registration_verified','source_publisher_is_government_naming_authority','underlying_hydrographic_dataset_independence_verified']),'Source interpretation and authority limits')
 require(len(o['observations'])==1,'Only one publication observation')
 s=o['observations'][0]
 require(s['source_key']==SOURCE_KEYS[0][0] and s['url']==PONT and s['publication_date'] is None and s['physical_pdf_page']==1 and s['printed_scale']=='1:340,000','Bibliography and printed scale')
 require(s['independent_underlying_naming_dataset_established'] is False and s['site_boundary_treated_as_shoreline'] is False and s['retrieved_this_batch'] is True,'Source dependence, site and acquisition scope')
 require([x['aw_id'] for x in o['complete_geometry_observations']]==AWIDS and [x['position_count'] for x in o['complete_geometry_observations']]==COUNTS,'Complete geometry observations')
 for x in o['complete_geometry_observations']:require(x['entire_source_and_baseline_geometry_viewed'] is True and x['whole_feature_map_scope_assessment_completed'] is True,'Whole map scope inspected')

def validate_content(root):
 g=check_geometry(root);r=read(root,'review/independent-review.json');check_verdict(r);check_research(root,r,g);check_prior_delta(root);check_observations(root)
 return dict(status='passed',mode='included_public_files_only',scope_aw_ids=AWIDS,lake_geometry_checks=g,included_ordered_position_count=120,recorded_historical_full_feature_reviews_completed=3,current_source_limited_targets=0,current_pending_access_ids=[],current_scope_hold_ids=AWIDS,current_follow_up_ids=AWIDS,preserved_pending_access_ids=PRIOR_PENDING,preserved_scope_hold_ids=PRIOR_HOLDS,recorded_prior_target_count=51,current_batch_increment=3,recorded_cumulative_distinct_targets=54,remaining_unrecorded_targets=4011,remaining_river_groups=3439,remaining_lakes=572,distinct_acquired_publications=1,distinct_cartographic_identity_publications=1,independent_source_groups=1,original_source_material_reopened=False,map_judgments_reproduced=False,prior_target_source_or_geometry_reaudit_performed=False,formal_registry_verified=False,automatic_application=False,network_requests=0,limit='Included-file integrity and factual linkage only. Omitted publications and past visual judgments are not reproduced. Two low-confidence geographic naming candidates and one null-candidate target remain on naming holds; completed map assessment does not establish complete-waterbody naming coverage or authority. All scalar outputs are null.')
def validate(root):
 root=Path(root);n=check_integrity(root);r=validate_content(root);r['public_input_files_checked']=n;r['included_component_manifests_checked']=2;return r
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=Path(__file__).resolve().parent.parent,help='Included package root');a=p.parse_args()
 try:r=validate(a.directory)
 except (ValueError,KeyError,TypeError,IndexError,OSError) as e:print(json.dumps(dict(status='failed',mode='included_public_files_only',error=str(e)),indent=2));return 1
 print(json.dumps(r,indent=2));return 0
if __name__=='__main__':sys.exit(main())
