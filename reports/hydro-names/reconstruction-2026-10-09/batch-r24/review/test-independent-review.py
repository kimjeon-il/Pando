#!/usr/bin/env python3
"""Current finite summary mutations; no omitted empirical judgments replayed."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
HERE=Path(__file__).resolve().parent

def run_tests():
    spec=importlib.util.spec_from_file_location('review_validator',HERE/'validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    baseline=m.validate_records(m.load_records());assert baseline['status']=='passed' and baseline['recorded_position_count']==1428
    cases=[
        ('target_order','review',('scope_aw_ids',0),'hydro-system:50798628'),
        ('geometry_domain','review',('findings',0,'logical_fid'),6979),
        ('missing_fragment','metadata',('fragments',2,'fragment_index'),0),
        ('partial_group','metadata',('fragments',1,'part_count'),68),
        ('wrong_positions','source',('complete_group_observations',2,'position_count'),600),
        ('richmond_basin_promoted','review',('findings',0,'research_category'),'supported_representative_system_identity'),
        ('richmond_false_direct_name','review',('findings',0,'directly_supported_name_forms'),['Richmond River']),
        ('richmond_hold_erased','review',('findings',0,'follow_up_required'),False),
        ('accessible_hold_marked_access_pending','review',('findings',0,'source_access_limited'),True),
        ('hold_review_marked_incomplete','review',('findings',0,'full_feature_correspondence_review_completed'),False),
        ('hawkesbury_scope_erased','review',('findings',1,'supported_name_scope'),'All reaches are Hawkesbury.'),
        ('hawkesbury_uniform_name','review',('findings',1,'uniform_river_name_for_group'),True),
        ('snowy_scalar_name','review',('findings',2,'scalar_product_name'),'Snowy River'),
        ('eucumbene_erased','review',('findings',2,'regional_distinct_channel_associations'),[]),
        ('storage_context_erased','review',('findings',1,'regional_distinct_channel_associations'),[]),
        ('exact_partition_invented','review',('findings',1,'regional_associations_are_exact_reach_assignments'),True),
        ('future_evidence_requirement_erased','review',('findings',2,'reach_level_naming_follow_up_required_before_product_application'),False),
        ('catchment_only_identity','review',('findings',1,'catchment_title_alone_used_as_identity'),True),
        ('public_decoder_replay_claim','review',('historical_review','historical_results_recomputed_by_public_validator'),True),
        ('full_path_claimed_included','review',('historical_review','full_selected_geometry_included'),True),
        ('publication_views_double_counted','source',('distinct_supporting_publications',),5),
        ('publication_year_confused','source',('observations',0,'publication_year'),2012),
        ('new_acquisition_invented','source',('observations',0,'retrieved_this_batch'),True),
        ('wrong_figure_page','source',('observations',0,'figures',3,'physical_pdf_page'),181),
        ('basin_leader_promoted','source',('observations',0,'figures',1,'scope'),'All basin callouts name all selected reaches.'),
        ('transfer_arrows_naturalized','source',('observations',0,'figures',2,'scope'),'Green arrows establish natural channel names.'),
        ('indistinct_label_certified','source',('observations',0,'figures',0,'scope'),'All direct names clearly legible.'),
        ('invented_named_station','review',('findings',1,'mapped_named_station_forms'),['Hawkesbury station']),
        ('formal_registry_upgrade','source',('formal_registry_verified',),True),
        ('broken_source_link','review',('findings',1,'source_keys'),['unrecorded_source']),
        ('duplicate_prior_current','continuity',('previous_aw_ids_in_index_order',0),'hydro-system:50691388'),
        ('pending_access_erased','review',('preserved_pending_access_ids',),[]),
        ('prior_holds_erased','review',('preserved_scope_hold_ids',),[]),
        ('new_hold_erased','review',('new_scope_hold_ids',),[]),
        ('ohrid_upgraded','review',('inherited_scope_continuity',1,'research_category'),'supported_generalized_water_identity'),
        ('victoria_qualifier_erased','review',('inherited_same_name_disambiguation',0,'supported_name_scope'),'Mitchell River representative identity.'),
        ('mitchell_regions_conflated','review',('inherited_same_name_disambiguation',1,'geographic_disambiguation'),'Victoria, Australia'),
        ('palmer_walsh_context_erased','review',('inherited_same_name_disambiguation',1,'regional_distinct_channel_associations'),[]),
        ('old_reaudit_claimed','review',('inherited_same_name_disambiguation',0,'prior_source_or_geometry_reaudited'),True),
        ('remaining_delta_wrong','continuity',('current_batch_delta','remaining_fresh_reconstruction_queue_after'),3994),
        ('raw_coordinates_added','review',('findings',0,'coordinates'),[[1,2],[3,4]]),
        ('omitted_source_fingerprint_added','source',('original_body_sha256',),'0'*64),
        ('unverified_korean_name','review',('findings',2,'name_ko'),'unverified'),
        ('invalid_current_timestamp','geometry',('created_at_utc',),'2026-10-09T20:60:00Z'),
        ('timezone_missing','geometry',('created_at_utc',),'2026-10-09T20:30:00'),
        ('bounded_support_incorrectly_pending','review',('findings',2,'follow_up_required'),True),
        ('product_application','review',('product_application',),True),
    ]
    rejected=[]
    for name,document,path,replacement in cases:
        records=copy.deepcopy(m.load_records());target=records[document]
        for key in path[:-1]:target=target[key]
        target[path[-1]]=replacement
        try:m.validate_records(records)
        except (AssertionError,KeyError,TypeError,ValueError):rejected.append(name)
        else:raise AssertionError('Mutation accepted: '+name)
    try:m.verify_bytes(b'changed included file',{'bytes':1,'sha256':'0'*64})
    except AssertionError:rejected.append('included_file_integrity')
    else:raise AssertionError('Altered included bytes accepted')
    return {'status':'passed','mode':'included_public_files_only','semantic_and_integrity_mutations_rejected':rejected,'network_requests':0,'original_map_or_full_path_or_decoder_judgments_reproduced':False,'limit':'Current public records and included-file integrity only. Tests do not establish geographic identities or repeat original decoding.'}

if __name__=='__main__':print(json.dumps(run_tests(),indent=2))
