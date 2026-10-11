#!/usr/bin/env python3
"""Derive the fresh-reconstruction remainder from two committed inputs, offline."""
import argparse,collections,csv,gzip,hashlib,io,json,pathlib,sys
sys.dont_write_bytecode=True
INVENTORY_SHA='5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db'
def rebuild(inventory_bytes,index,include_ids=False):
 assert hashlib.sha256(inventory_bytes).hexdigest()==INVENTORY_SHA,'initial inventory byte hash mismatch'
 rows=list(csv.DictReader(io.StringIO(gzip.decompress(inventory_bytes).decode('utf-8'))))
 assert len(rows)==5173 and len({r['aw_id']for r in rows})==5173,'initial inventory units'
 eligible=[r for r in rows if r['classification']!='named_display']
 assert len(eligible)==4065,'eligible initial universe'
 eligible_by_id={r['aw_id']:r for r in eligible};normal=lambda r:'river_group'if r['category']=='river'else r['category']
 assert collections.Counter(normal(r)for r in eligible)=={'river_group':3455,'lake':610},'initial type counts'
 records=index['records']; reviewed=[r['aw_id']for r in records]
 assert len(reviewed)==len(set(reviewed))==index['total_distinct_reconstructed_targets'],'duplicate/count index mismatch'
 assert set(reviewed)<=set(eligible_by_id),'reviewed target is not initially eligible'
 assert all(r['category']==normal(eligible_by_id[r['aw_id']])for r in records),'target type mismatch'
 assert all(r['automatic_application']is False for r in records),'application not allowed by research index'
 assert index['automatic_application']is False
 residual=[r for r in eligible if r['aw_id']not in set(reviewed)]
 by_type=dict(collections.Counter(normal(r)for r in residual))
 facts=index['remaining_queue_recovery']
 assert facts['initial_inventory']['sha256']==INVENTORY_SHA
 assert facts['eligible_universe_count']==4065
 assert facts['reviewed_index_targets']==len(reviewed)
 assert facts['remaining_without_reconstructed_record']==len(residual)
 assert facts['remaining_without_reconstructed_record_by_type']==by_type
 assert facts['historical_never_reviewed_count_claimed']is False
 pending=[r['aw_id']for r in records if r.get('source_access_limited')is True]
 holds=[r['aw_id']for r in records if r['research_category']in {'whole_polygon_scope_hold','supported_reservoir_association_geometry_hold','candidate_waterbody_identity_extent_hold','compound_feature_name_scope_hold','river_group_name_scope_hold'}and r['aw_id']not in pending]
 assert index['recorded_index_targets']==len(records)and index['complete_identity_review_claimed_for_all_records']is False
 assert index['pending_access_ids']==pending and index['pending_access_count']==len(pending),'pending-access index mismatch'
 assert index['scope_hold_ids']==holds and index['scope_hold_count']==len(holds),'scope-hold index mismatch'
 assert not(set(pending)&{r['aw_id']for r in residual})and not(set(pending)&set(holds))
 assert all(r.get('full_feature_correspondence_review_completed')is False and r.get('follow_up_required')is True for r in records if r['aw_id']in pending),'access-pending coverage falsely completed'
 result={'status':'passed','initial_inventory_rows':5173,'initial_eligible_targets':4065,'reviewed_index_targets':len(reviewed),'remaining_without_reconstructed_record':len(residual),'remaining_by_type':by_type,'recorded_index_targets':len(records),'pending_access_ids':pending,'pending_access_count':len(pending),'scope_hold_ids':holds,'scope_hold_count':len(holds),'queue_order':'original_inventory_row_order','scope':'Remaining means absent from this fresh reconstructed index. It does not mean historically never researched; the unavailable historical504-record ledger is not reconstructed.','network_calls':0,'automatic_application':False}
 if include_ids:result['remaining_aw_ids']=[r['aw_id']for r in residual]
 return result
if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--inventory',type=pathlib.Path,required=True,help='Exact committed inventory.csv.gz');ap.add_argument('--index',type=pathlib.Path,default=pathlib.Path(__file__).with_name('reconstruction-index.json'));ap.add_argument('--include-ids',action='store_true');a=ap.parse_args()
 print(json.dumps(rebuild(a.inventory.read_bytes(),json.loads(a.index.read_text()),a.include_ids),ensure_ascii=False,indent=2))
