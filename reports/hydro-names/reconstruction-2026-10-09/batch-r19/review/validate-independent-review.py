#!/usr/bin/env python3
"""Offline validation of included r19 public summaries and factual linkage only."""
import argparse,hashlib,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
AWIDS=['hydro-system:50517279','hydro-system:50478600','hydro-system:50464082']
SYSTEMS=['50517279','50478600','50464082']
NAMES=['Burdekin River','Gilbert River','Mitchell River']
LOGICAL=[1859,1826,1810]
FIDS=[list(range(6789,6797)),[6740,6741],list(range(6714,6722))]
PARTS=[208,112,232];POSITIONS=[1034,782,1544]
ROLES=[['mainstem']*6+['tributary']*2,['mainstem']*2,['mainstem']*3+['tributary']*5]
STAGES=[[3,2,1,0,1,0,3,2],[3,1],[3,1,0,3,2,1,3,2]]
FRAGMENT_PARTS=[[68,26,48,9,6,12,29,10],[91,21],[64,47,2,61,8,17,23,10]]
FRAGMENT_POSITIONS=[[323,137,254,37,47,74,125,37],[580,202],[455,241,4,417,67,105,179,76]]
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR_COMMIT='6badfae989089b3d54cd5ced22302ff125c61d14'
BOM='https://www.bom.gov.au/water/awra/2012/documents/assessment-lr.pdf'
PRIOR_PENDING=['lakes_base:1159112821','lakes_base:1159108815']
PRIOR_HOLDS=['lakes_base:'+n for n in ['1159109497','1159123531','1159123567','1159110371','1159109471','1159111751','1159112207','1159110475','1159108993','1159109803','1159108469','1159108703','1159109993','1159110087','1159116675','1159118183','1159118201']]
REVIEW_NAMES=['README.md','independent-review.json','public-input-pins.json','review-validation.json','source-observations.json','test-independent-review.py','validate-independent-review.py']
GEOMETRY_NAMES=['geometry-reference.json','selected-river-metadata.json','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json']
RESEARCH_NAMES=['README.md','findings.json','source-evidence.json','target-identity-facts.json','map-scope-review.json']

def require(c,message):
 if not c:raise ValueError(message)
def path(root,relative):
 root=Path(root).resolve();p=(root/relative).resolve();require(p.is_relative_to(root),'Included package path only');return p
def read(root,relative):return json.loads(path(root,relative).read_bytes())
def checked(root,relative,pin):
 b=path(root,relative).read_bytes();require(len(b)==pin['bytes'] and hashlib.sha256(b).hexdigest()==pin['sha256'],'Included file integrity: '+relative)
def input_names():return GEOMETRY_NAMES+['geometry-component-manifest.json']+['research/queensland/'+n for n in RESEARCH_NAMES+['research-manifest.json']]
def integrity(root):
 p=read(root,'review/public-input-pins.json');expected=input_names();require(p['scope']=='included_public_files_only' and p['batch']=='r19' and p['automatic_application'] is False,'Included input scope')
 require(len(p['files'])==len(expected) and {r['path'] for r in p['files']}==set(expected),'Exact included input set')
 for row in p['files']:checked(root,row['path'],row)
 gm=read(root,'geometry-component-manifest.json');require(gm['scope_aw_ids']==AWIDS and set(gm['files'])==set(GEOMETRY_NAMES),'Exact geometry component set')
 for n,h in gm['files'].items():require(hashlib.sha256(path(root,n).read_bytes()).hexdigest()==h,'Geometry component integrity')
 for folder,manifest,names,key in [('research/queensland','research-manifest.json',RESEARCH_NAMES,'path'),('review','review-manifest.json',REVIEW_NAMES,'file')]:
  m=read(root,folder+'/'+manifest);require(m['scope']=='included_public_files_only' and m['automatic_application'] is False,'Manifest public-only scope');require(len(m['files'])==len(names) and {x[key] for x in m['files']}==set(names),'Exact component file set')
  for row in m['files']:checked(root,folder+'/'+row[key],row)
 return len(expected)

def geometry(root):
 ref=read(root,'geometry-reference.json');rows=read(root,'selected-river-metadata.json')['fragments'];inv=read(root,'selected-inventory-records.json')['records']
 require(ref['scope_aw_ids']==AWIDS and ref['baseline']['git_commit']==COMMIT and ref['validation_scope']=='included-summary-evidence-only','Fixed summarized geometry scope')
 require(len(rows)==18 and len(ref['groups'])==len(inv)==3,'Exact selected group and fragment counts')
 require([x['fid'] for x in rows]==[f for fs in FIDS for f in fs],'Ordered fragment IDs')
 out=[]
 for i,(g,r) in enumerate(zip(ref['groups'],inv)):
  require((g['aw_id'],g['system_id'],g['logical_fid'],g['geometry_fids'])==(AWIDS[i],SYSTEMS[i],LOGICAL[i],FIDS[i]),'Geometry identity domains')
  require((g['fragment_count'],g['part_count'],g['position_count'],g['source_reach_count'])==(len(FIDS[i]),PARTS[i],POSITIONS[i],PARTS[i]),'Complete group summary counts')
  require(g['role_sequence']==ROLES[i] and g['fragment_part_counts']==FRAGMENT_PARTS[i] and g['fragment_position_counts']==FRAGMENT_POSITIONS[i],'Group fragment summaries')
  require((r['aw_id'],r['system_id'],r['logical_fid'],r['geometry_fids'],r['geometry_count'],r['source_reach_count'])==(AWIDS[i],SYSTEMS[i],LOGICAL[i],FIDS[i],len(FIDS[i]),PARTS[i]),'Inventory summary join')
  require(r['bbox']==g['bounds'] and r['has_korean_display'] is False and r['classification']=='no_meaningful_name_in_deployed_data','Inventory eligibility summary')
  selected=[x for x in rows if x['aw_id']==AWIDS[i]]
  for j,f in enumerate(selected):
   require((f['system_id'],f['fid'],f['logical_fid'],f['fragment_index'],f['fragment_count'],f['role'],f['stage'])==(SYSTEMS[i],FIDS[i][j],LOGICAL[i],j,len(FIDS[i]),ROLES[i][j],STAGES[i][j]),'Selected metadata linkage')
   require((f['part_count'],f['position_count'],f['source_reach_count'])==(FRAGMENT_PARTS[i][j],FRAGMENT_POSITIONS[i][j],FRAGMENT_PARTS[i][j]),'Fragment count linkage')
   counts=f['position_counts_by_part'];require(len(counts)==f['part_count'] and sum(counts)==f['position_count'] and all(isinstance(n,int) and n>=2 for n in counts),'Included count summary arithmetic')
   require(f['research_name_ko'] is None and f['automatic_application'] is False,'No research name application')
  out.append(dict(aw_id=AWIDS[i],fragment_count=len(FIDS[i]),part_count=PARTS[i],position_count=POSITIONS[i],included_summaries_consistent=True,omitted_coordinates_recomputed=False))
 require(ref['historical_private_verification']['public_validator_reproduces_these_omitted_input_checks'] is False and ref['original_hydrorivers_geometry']['source_coordinate_equality_verified'] is False,'Recorded original verification versus included summary validation')
 return out

def verdict(root):
 r=read(root,'review/independent-review.json');require(r['scope_aw_ids']==AWIDS and [f['aw_id'] for f in r['findings']]==AWIDS,'Review selected order')
 require(r['baseline_commit']==COMMIT and (r['prior_distinct_targets'],r['current_batch_increment'],r['cumulative_distinct_targets'],r['duplicate_targets'])==(54,3,57,0),'Review baseline and unique counts')
 require((r['current_batch_full_feature_correspondence_reviews_completed'],r['current_batch_source_limited_targets'],r['current_batch_follow_up_required_targets'],r['current_batch_scope_hold_targets'],r['scalar_product_name_approvals'])==(3,0,0,0,0),'Bounded research completion counts')
 for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','original_hydrorivers_coordinate_equality_verified','all_reach_names_verified','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed']:require(r[k] is False,'Closed review gate: '+k)
 require(r['preserved_pending_access_ids']==PRIOR_PENDING and r['preserved_scope_hold_ids']==PRIOR_HOLDS and r['new_pending_access_ids']==r['new_scope_hold_ids']==[],'Preserved access and naming holds')
 for i,f in enumerate(r['findings']):
  require((f['system_id'],f['logical_fid'],f['geometry_fids'],f['fragment_count'],f['part_count'],f['position_count'])==(SYSTEMS[i],LOGICAL[i],FIDS[i],len(FIDS[i]),PARTS[i],POSITIONS[i]),'Review summary join')
  require(f['baseline_fragment_roles']==ROLES[i] and f['baseline_stage_sequence']==STAGES[i],'Review fragment roles and stages')
  require(f['candidate_name']==NAMES[i] and f['directly_supported_name_forms']==[NAMES[i]] and f['research_category']=='supported_representative_system_identity' and f['review_status']=='representative_system_supported_with_reach_name_limits','Bounded representative identities')
  require(f['source_access_limited'] is False and f['full_feature_correspondence_review_completed'] is True and f['follow_up_required'] is False and f['reach_level_naming_follow_up_required_before_product_application'] is True,'Bounded task completed; future product naming still requires evidence')
  require(all(f[k] is None for k in ['whole_group_scalar_name','scalar_product_name','name_ko','name_en','name_original']),'Scalar and language outputs remain null')
  for k in ['automatic_application','product_application','scalar_product_name_approved','whole_group_scalar_application_approved','whole_reach_name_application_cleared','all_reach_names_verified','uniform_river_name_for_group','formal_registry_verified','exact_source_reach_name_transitions_verified','exact_surveyed_mouth_verified','topology_repaired','label_overlap_alone_used_as_identity','catchment_title_alone_used_as_identity','regional_associations_are_exact_reach_assignments']:require(f[k] is False,'Closed naming gate: '+k)
  require(all(f[k] is True for k in ['complete_baseline_group_compared','all_selected_branches_considered','private_original_pack_and_metadata_independently_decoded']),'Recorded complete private assessment')
  require(f['source_keys']==['bom_australian_water_resources_assessment_2012'] and len(f['limits'])>=4 and bool(f['supported_name_scope']) and bool(f['follow_up_scope']),'Evidence and scope present')
  require(f['regional_distinct_channel_associations']==[[],['Einasleigh'],['Palmer','Walsh']][i],'Distinct regional channel associations remain bounded')
  c=f['confidence'];require(c['representative_system_association']=='moderate' and c['reach_level_name_assignment']=='not established' and c['formal_naming_authority_verified'] is False and c['numerical_probability_claimed'] is False,'Single-source representative confidence')
 require('southern tributary' in r['findings'][0]['supported_name_scope'] and 'Einasleigh' in r['findings'][1]['supported_name_scope'] and all(n in r['findings'][2]['supported_name_scope'] for n in ['Palmer','Walsh','shorter northern tributary']),'Explicit representative-versus-reach limits')
 h=r['historical_review'];require(h['performed_at_utc']==r['reviewed_at_utc'] and h['available_source_inspection_completed'] is True and h['full_feature_correspondence_review_completed'] is True and h['original_source_material_included'] is False and h['full_selected_geometry_included'] is False and h['historical_results_recomputed_by_public_validator'] is False,'Historical private review distinguished from public validation')
 inherited=r['inherited_scope_continuity'];require([x['aw_id'] for x in inherited]==['lakes_base:1159109723','lakes_base:1159116675','lakes_base:1159118183','lakes_base:1159118201'],'Bounded prior scope continuity')
 require(inherited[0]['candidate_name']=='Sandfly Lake' and all(s in inherited[0]['supported_name_scope'] for s in ['eastern basin','not equivalence with the entire named lake','connecting river water']),'Sandfly partial-basin limit')
 for i,x in enumerate(inherited[1:]):
  require(x['candidate_name']==['Lake Ohrid','Prespa Lake',None][i] and x['research_category']==['candidate_waterbody_identity_extent_hold','candidate_waterbody_identity_extent_hold','whole_polygon_scope_hold'][i],'Prior candidate and hold categories')
  require(x['source_access_limited'] is False and x['full_feature_correspondence_review_completed'] is True and x['follow_up_required'] is True and x['naming_scope_details']['directly_supported_name_forms']==[],'Prior completed assessments retain naming follow-up')
  if i<2:require('low-confidence' in x['supported_name_scope'] and x['naming_scope_details']['candidate_name_role']=='geographic_candidate_only_extent_hold','Prior low-confidence candidate preserved')
 return r

def prior_delta(root):
 d=read(root,'geometry-duplicate-check.json');old=d['previous_aw_ids_in_index_order'];require(len(old)==len(set(old))==54 and not set(old)&set(AWIDS),'Prior54 membership and unique current delta')
 require(d['selected_aw_ids']==AWIDS and d['intersection_aw_ids']==[] and len(set(old+AWIDS))==57,'New three and cumulative57')
 require(PRIOR_COMMIT in d['previous_index_immutable_url'] and d['preserved_pending_access_ids']==PRIOR_PENDING and d['preserved_scope_hold_ids']==PRIOR_HOLDS,'Prior provenance and unchanged holds')
 require(d['pending_access_reassessment_performed'] is False and d['scope_hold_reassessment_performed'] is False,'No old source reassessment')
 x=d['current_batch_delta'];require((x['initial_eligible_target_count'],x['reconstructed_target_count_before'],x['reconstructed_target_count_after'],x['remaining_fresh_reconstruction_queue_before'],x['remaining_fresh_reconstruction_queue_after'])==(4065,54,57,4011,4008),'Queue arithmetic')
 require(x['remaining_queue_types_after']=={'river_group':3436,'lake':572} and x['selected_current_target_types']=={'river_group':3},'Remaining river and lake counts')
 require(x['historically_never_reviewed_count_claimed'] is False and x['prior_target_geometry_or_naming_revalidation_performed'] is False,'Fresh-index scope only')

def observations(root,r):
 o=read(root,'review/source-observations.json');require(o['scope_aw_ids']==AWIDS and o['new_external_requests']==0 and (o['distinct_supporting_publications'],o['distinct_cartographic_identity_publications'],o['independent_source_groups'])==(1,1,1),'One reused publication only')
 for k in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified','registered_overlay_performed','exact_surveyed_mouth_verified']:require(o[k] is False,'Source limits: '+k)
 require(len(o['observations'])==1,'One report observation');s=o['observations'][0];require(s['source_key']=='bom_australian_water_resources_assessment_2012' and s['url']==BOM and s['assessment_year']==2012 and s['publication_year']==2013,'Source bibliography')
 require(s['original_acquired_at_utc']=='2026-10-09T13:39:46.198340+00:00' and s['retrieved_this_batch'] is False and s['reused_original'] is True and s['original_map_pixels_viewed'] is True and s['is_formal_naming_registry'] is False,'Reuse and map-view facts')
 require([(x['figure'],x['physical_pdf_page'],x['printed_chapter_page']) for x in s['figures']]==[('3.1',48,5),('3.22',69,26),('3.61',108,65),('15.1',681,5),('15.22',703,27)],'Exact original figure references')
 require([x['aw_id'] for x in o['complete_group_observations']]==AWIDS,'Whole group observations')
 for i,x in enumerate(o['complete_group_observations']):
  require((x['geometry_fids'],x['fragment_count'],x['part_count'],x['position_count'])==(FIDS[i],len(FIDS[i]),PARTS[i],POSITIONS[i]),'Observation summaries')
  require(x['entire_selected_baseline_group_viewed'] is True and x['all_selected_branches_considered'] is True and x['independent_observation']==r['findings'][i]['supported_name_scope'],'Complete bounded correspondence observations')

def research(root,r):
 pre='research/queensland/';f=read(root,pre+'findings.json');rows=f['records']
 require([x['aw_id'] for x in rows]==AWIDS,'Research target order')
 require((f['target_count'],f['new_actual_inventory_targets'],f['full_feature_correspondence_review_completed_count'],f['supported_representative_system_identity_count'],f['source_limited_unresolved_count'],f['all_reach_names_verified_count'])==(3,3,3,3,0,0),'Research bounded completion counts')
 require(f['automatic_application'] is False and f['product_application'] is False,'Research product gates')
 components=[['Burdekin River',None,None],['Gilbert','Einasleigh',None],['Mitchell','Palmer','Walsh',None,None]]
 for i,row in enumerate(rows):
  reviewed=r['findings'][i]
  for k in ['candidate_name','research_category','directly_supported_name_forms','source_keys','source_access_limited','full_feature_correspondence_review_completed','follow_up_required','all_reach_names_verified','whole_group_scalar_name','follow_up_scope']:
   require(row[k]==reviewed[k],'Research review join: '+k)
  require(row['system_id']==SYSTEMS[i] and row['korean_name'] is None and row['full_geometry_inspected'] is True and row['map_resolution_limited'] is True,'Research bounded facts')
  for k in ['formal_registry_verified','exact_name_partition_established','exact_source_topology_verified','exact_shoreline_or_estuary_boundary_verified','geometry_modified','automatic_application','product_application']:require(row[k] is False,'Research gate: '+k)
  require(bool(row['follow_up_scope']) and 'separately authorized' in row['follow_up_scope'] and len(row['name_scope_limits'])==4,'Conditional future naming evidence')
  require([x['name'] for x in row['component_associations']]==components[i] and all(x['exact_reach_assignment'] is False for x in row['component_associations']),'Named versus unassigned corridor associations')
  c=row['confidence'];require(c['generalized_group_association']=='moderate' and c['named_corridor_associations']=='moderate' and c['whole_group_scalar_name']==c['all_reach_name_partition']=='not established' and c['formal_naming_authority_verified'] is False and c['numerical_probability_claimed'] is False,'Research representative confidence only')
 facts=read(root,pre+'target-identity-facts.json');require([x['aw_id'] for x in facts['targets']]==AWIDS and (facts['total_fragment_count'],facts['total_part_count'],facts['total_coordinate_count'])==(18,552,3360),'Whole group source facts')
 require(facts['complete_coordinate_arrays_included'] is False and facts['automatic_application'] is False and facts['product_application'] is False,'Source facts summary only')
 inv=read(root,'selected-inventory-records.json')['records']
 for i,row in enumerate(facts['targets']):
  require((row['system_id'],row['logical_fid'],row['baseline_fids'],row['inventory_geometry_count'],row['complete_baseline_part_count'],row['complete_baseline_coordinate_count'],row['source_reach_count'])==(SYSTEMS[i],LOGICAL[i],FIDS[i],len(FIDS[i]),PARTS[i],POSITIONS[i],PARTS[i]),'Source identity and count join')
  require(row['inventory_bbox']==inv[i]['bbox'] and row['rendered_mainstem_length_km']==inv[i]['rendered_mainstem_length_km'] and row['rendered_network_length_km']==inv[i]['rendered_network_length_km'],'Source included inventory summary join')
  require(row['all_selected_fragments_parts_and_positions_considered'] is True and row['original_hydrorivers_source_coordinate_equality_verified'] is False and row['geometry_modified'] is False,'Private whole-path observation limits')
  require([(x['fid'],x['fragment_index'],x['graph_role'],x['part_count'],x['coordinate_count']) for x in row['fragments']]==list(zip(FIDS[i],range(len(FIDS[i])),ROLES[i],FRAGMENT_PARTS[i],FRAGMENT_POSITIONS[i])),'All source fragment summaries')
 ev=read(root,pre+'source-evidence.json');require((ev['distinct_publication_count'],ev['independent_source_count'],ev['independent_cartographic_identity_source_count'],ev['formal_government_naming_registry_count'],ev['new_external_request_count'])==(1,1,1,0,0),'One existing assessment; no formal registry')
 require(ev['search_snippets_used_as_identity_evidence'] is False and ev['automatic_application'] is False and ev['product_application'] is False and len(ev['sources'])==1,'Source evidence gates')
 s=ev['sources'][0];require(s['source_key']=='bom_australian_water_resources_assessment_2012' and s['url']==BOM and s['publication_year']==2013 and s['assessment_period']=='2011-12','Exact source bibliography')
 require(s['retrieved_at_utc']=='2026-10-09T13:39:46.198340+00:00' and s['retrieved_this_batch'] is False and s['original_map_visually_inspected'] is True,'Original reuse and map inspection')
 require([x['physical_pdf_page'] for x in s['map_locations']]==[48,69,108,681,703] and [x['physical_pdf_page'] for x in s['supporting_text_locations']]==[68,105,106,702,707],'Source locations')
 require(s['short_direct_channel_labels']==['Burdekin','Burdekin R.','Gilbert','Einasleigh','Mitchell','Palmer','Walsh'],'Literal labels distinct from full representative forms')
 scope=read(root,pre+'map-scope-review.json');require([x['aw_id'] for x in scope['records']]==AWIDS and scope['map_graticule_or_control_point_registration_performed'] is False,'No survey registration')
 for i,row in enumerate(scope['records']):
  require((row['complete_fragment_count'],row['complete_part_count'],row['complete_coordinate_count'])==(len(FIDS[i]),PARTS[i],POSITIONS[i]),'All paths considered in recorded source review')
  require(row['source_access_limited'] is False and row['full_feature_correspondence_review_completed'] is True and row['follow_up_required'] is False and row['all_reach_names_verified'] is False,'Source map assessment versus reach naming')
  require(row['assessment']==rows[i]['supported_name_scope'] and row['source_keys']==rows[i]['source_keys'],'Source scope linkage')

def privacy_contract(root):
 forbidden={'coordinates','canonical_geometry_sha256','canonical_ordered_group_geometry_sha256','ordered_coordinate_sha256','source_body_sha256','private_original_body_sha256','local_evidence_assets','original_source_receipt_links','source_assets','local_source_index','sourceEndpoint','renderEndpoint'}
 def walk(x):
  if isinstance(x,dict):
   require(not (set(x)&forbidden),'Omitted originals, full paths and fingerprints must stay outside public records')
   for v in x.values():walk(v)
  elif isinstance(x,list):
   for v in x:walk(v)
 for n in input_names()+['review/independent-review.json','review/source-observations.json']:
  if n.endswith('.json'):walk(read(root,n))

def validate_content(root):
 g=geometry(root);r=verdict(root);prior_delta(root);observations(root,r);research(root,r);privacy_contract(root)
 return dict(status='passed',mode='included_public_files_only',scope_aw_ids=AWIDS,included_geometry_summary_checks=g,recorded_fragment_count=18,recorded_part_count=552,recorded_position_count=3360,recorded_full_feature_correspondence_reviews_completed=3,representative_system_identities_supported=3,current_source_limited_targets=0,current_scope_hold_ids=[],current_follow_up_ids=[],future_reach_level_naming_requires_separate_evidence=True,preserved_pending_access_ids=PRIOR_PENDING,preserved_scope_hold_ids=PRIOR_HOLDS,recorded_prior_target_count=54,current_batch_increment=3,recorded_cumulative_distinct_targets=57,remaining_unrecorded_targets=4008,remaining_river_groups=3436,remaining_lakes=572,distinct_supporting_publications=1,independent_source_groups=1,original_source_material_reopened=False,map_judgments_reproduced=False,omitted_full_paths_recomputed=False,original_decoder_replayed=False,prior_target_source_or_geometry_reaudit_performed=False,formal_registry_verified=False,all_reach_names_verified=False,scalar_product_name_approvals=0,automatic_application=False,product_application=False,network_requests=0,limit='Included-file integrity, summaries and factual linkage only. Omitted original map pixels, full selected paths and private decoder judgments are not reproduced. Supported representative system identities do not assign names to every mainstem/tributary reach or approve scalar/product application.')
def validate(root):
 root=Path(root);n=integrity(root);out=validate_content(root);out['public_input_files_checked']=n;out['included_dependency_manifests_checked']=2;return out
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=Path(__file__).resolve().parent.parent,help='Included package root');args=p.parse_args()
 try:out=validate(args.directory)
 except (ValueError,KeyError,TypeError,IndexError,OSError) as e:print(json.dumps(dict(status='failed',mode='included_public_files_only',error=str(e)),indent=2));return 1
 print(json.dumps(out,indent=2));return 0
if __name__=='__main__':sys.exit(main())
