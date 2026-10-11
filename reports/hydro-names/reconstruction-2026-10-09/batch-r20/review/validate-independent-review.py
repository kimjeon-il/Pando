#!/usr/bin/env python3
"""Offline consistency of included r20 summaries, not empirical review replay."""
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent
IDS = ["hydro-system:50624422", "hydro-system:50663106", "hydro-system:50668362"]
NAMES = ["Mary River", "Brisbane River", "Logan River"]
LOGICAL = [1949, 1992, 2003]
FIDS = [6893, 6936, 6947]
PARTS = [49, 76, 34]
POSITIONS = [326, 491, 251]
STATIONS = ["Miva", "Savages Crossing", "Yarrahappini"]
SOURCE = "bom_australian_water_resources_assessment_2012"
SOURCE_URL = "https://www.bom.gov.au/water/awra/2012/documents/assessment-lr.pdf"
STAMP = "2026-10-09T18:59:52.912579+00:00"
GEOMETRY_FILES = {
    "geometry-reference.json", "selected-river-metadata.json",
    "selected-inventory-records.json", "geometry-duplicate-check.json",
    "geometry-publication-rights.json", "geometry-README.md",
    "validate-geometry-reference.py", "test-geometry-reference.py",
    "geometry-validation.json", "geometry-component-manifest.json",
}
REVIEW_FILES = {
    "README.md", "independent-review.json", "source-observations.json",
    "public-input-pins.json", "review-validation.json", "review-manifest.json",
    "validate-independent-review.py", "test-independent-review.py",
}
DOCUMENTS = {
    "review": "review/independent-review.json",
    "source": "review/source-observations.json",
    "geometry": "geometry-reference.json",
    "metadata": "selected-river-metadata.json",
    "inventory": "selected-inventory-records.json",
    "continuity": "geometry-duplicate-check.json",
}


def equal(actual, expected):
    assert json.dumps(actual, sort_keys=True) == json.dumps(expected, sort_keys=True)


def read_json(file):
    assert file.is_file() and not file.is_symlink()
    return json.loads(file.read_text(encoding="utf-8"))


def load_records():
    return {key: read_json(PUBLIC / name) for key, name in DOCUMENTS.items()}


def verify_bytes(body, pin):
    equal(len(body), pin["bytes"])
    equal(hashlib.sha256(body).hexdigest(), pin["sha256"])


def reject_omitted_payload(value):
    if isinstance(value, dict):
        for key, child in value.items():
            assert key not in {"coordinates", "coordinate_arrays", "part_endpoints", "cache_dir"}
            assert not any(term in key.lower() for term in ("sha256", "fingerprint", "checksum"))
            reject_omitted_payload(child)
    elif isinstance(value, list):
        for child in value:
            reject_omitted_payload(child)


def validate_records(records):
    review, source, geometry, metadata, inventory, continuity = (
        records[key] for key in DOCUMENTS
    )
    reject_omitted_payload(review)
    reject_omitted_payload(source)
    equal(review["schema"], "hydro-independent-river-review-v4")
    equal(source["schema"], "hydro-public-source-observations-v4")
    for document in (review, source, geometry):
        equal(document["batch"], "r20")
    for document in (review, source, geometry, metadata, inventory):
        equal(document["scope_aw_ids"], IDS)
    equal(review["reviewed_at_utc"], STAMP)
    equal(review["baseline_commit"], geometry["baseline"]["git_commit"])
    equal(review["baseline_commit"], "fd6744f5e72a0c1a107452dbde6d416ab57237db")
    for key in (
        "automatic_application", "product_application", "geometry_modified",
        "topology_repaired", "current_live_deployment_checked", "historical_verdicts_restored",
        "original_hydrorivers_coordinate_equality_verified", "all_reach_names_verified",
        "pending_access_reassessment_performed", "prior_target_source_or_geometry_reaudit_performed",
    ):
        equal(review[key], False)
    equal(review["scalar_product_name_approvals"], 0)
    for key, count in {
        "prior_distinct_targets": 57, "current_batch_increment": 3,
        "cumulative_distinct_targets": 60, "duplicate_targets": 0,
        "current_batch_full_feature_correspondence_reviews_completed": 3,
        "current_batch_source_limited_targets": 0, "current_batch_follow_up_required_targets": 0,
        "current_batch_scope_hold_targets": 0,
    }.items():
        equal(review[key], count)
    equal(review["new_pending_access_ids"], [])
    equal(review["new_scope_hold_ids"], [])
    historical = review["historical_review"]
    equal(historical, {
        "performed_at_utc": STAMP, "available_source_inspection_completed": True,
        "full_feature_correspondence_review_completed": True,
        "original_source_material_included": False, "full_selected_geometry_included": False,
        "historical_results_recomputed_by_public_validator": False,
    })

    equal(source["new_external_requests"], 0)
    for key in ("distinct_supporting_publications", "distinct_cartographic_identity_publications", "independent_source_groups"):
        equal(source[key], 1)
    for key in ("underlying_hydrographic_dataset_independence_verified", "formal_registry_verified", "registered_overlay_performed", "exact_surveyed_mouth_verified"):
        equal(source[key], False)
    equal(len(source["observations"]), 1)
    publication = source["observations"][0]
    for key, expected in {
        "source_key": SOURCE, "title": "Australian Water Resources Assessment 2012",
        "publisher": "Bureau of Meteorology, Commonwealth of Australia", "url": SOURCE_URL,
        "assessment_year": 2012, "publication_year": 2013, "publication_date_precision": "year",
        "original_acquired_at_utc": "2026-10-09T13:39:46.198340+00:00",
        "retrieved_this_batch": False, "reused_original": True,
        "original_map_pixels_viewed": True, "is_formal_naming_registry": False,
        "supporting_text_physical_pdf_pages": [81, 82],
    }.items():
        equal(publication[key], expected)
    equal(
        [[f["figure"], f["physical_pdf_page"], f["printed_chapter_page"]] for f in publication["figures"]],
        [["3.1", 48, 5], ["3.22", 69, 26], ["3.34", 81, 38],
         ["3.37", 82, 39], ["3.47", 94, 51], ["3.48", 96, 53]],
    )
    for index in (0, 1, 4, 5):
        assert "context only" in publication["figures"][index]["scope"]
    assert "Mary River" in publication["figures"][2]["scope"]
    assert "Brisbane River and Logan River" in publication["figures"][3]["scope"]

    collections = [review["findings"], source["complete_group_observations"], geometry["groups"], metadata["fragments"], inventory["records"]]
    for collection in collections:
        equal([row["aw_id"] for row in collection], IDS)
    for i, (finding, observation, group, fragment, row) in enumerate(zip(*collections)):
        for item in (finding, group, fragment, row):
            equal(item["system_id"], IDS[i].split(":")[1])
            equal(item["logical_fid"], LOGICAL[i])
        for item in (finding, observation, group, row):
            equal(item["geometry_fids"], [FIDS[i]])
        equal(fragment["fid"], FIDS[i])
        equal(fragment["fragment_index"], 0)
        equal(row["geometry_count"], 1)
        for item in (finding, observation, group, fragment):
            for key, expected in (("fragment_count", 1), ("part_count", PARTS[i]), ("position_count", POSITIONS[i])):
                equal(item[key], expected)
        equal(len(fragment["position_counts_by_part"]), PARTS[i])
        equal(sum(fragment["position_counts_by_part"]), POSITIONS[i])
        equal(finding["baseline_fragment_roles"], ["mainstem"])
        equal(group["role_sequence"], ["mainstem"])
        equal(fragment["role"], "mainstem")
        equal(finding["baseline_stage_sequence"], [3])
        equal(fragment["stage"], 3)
        equal(group["minimum_stage"], row["minimum_stage"])
        equal(group["minimum_stage"], 3)
        equal(finding["candidate_name"], NAMES[i])
        equal(finding["directly_supported_name_forms"], [NAMES[i]])
        equal(finding["source_keys"], [SOURCE])
        equal(finding["research_category"], "supported_representative_system_identity")
        equal(finding["review_status"], "representative_system_supported_with_reach_name_limits")
        equal(finding["supported_name_scope"], observation["independent_observation"])
        for text in (NAMES[i], STATIONS[i], "coastal", "mainstem" if i != 2 else "No Albert reach assignment"):
            assert text in finding["supported_name_scope"]
        assert "headwater" in finding["follow_up_scope"] and "storage" in finding["follow_up_scope"]
        assert "coastal" in finding["follow_up_scope"] and "separately authorized" in finding["follow_up_scope"]
        for key in ("whole_group_scalar_name", "scalar_product_name", "name_ko", "name_en", "name_original"):
            equal(finding[key], None)
        for key in (
            "source_access_limited", "follow_up_required", "automatic_application", "product_application",
            "scalar_product_name_approved", "whole_group_scalar_application_approved",
            "whole_reach_name_application_cleared", "all_reach_names_verified", "uniform_river_name_for_group",
            "formal_registry_verified", "exact_source_reach_name_transitions_verified",
            "exact_surveyed_mouth_verified", "topology_repaired", "label_overlap_alone_used_as_identity",
            "catchment_title_alone_used_as_identity", "regional_associations_are_exact_reach_assignments",
        ):
            equal(finding[key], False)
        for key in (
            "full_feature_correspondence_review_completed", "reach_level_naming_follow_up_required_before_product_application",
            "complete_baseline_group_compared", "all_selected_branches_considered",
            "private_original_pack_and_metadata_independently_decoded",
        ):
            equal(finding[key], True)
        equal(observation["entire_selected_baseline_group_viewed"], True)
        equal(observation["all_selected_branches_considered"], True)
        equal(finding["regional_distinct_channel_associations"], [])
        equal(finding["confidence"]["representative_system_association"], "moderate")
        equal(finding["confidence"]["reach_level_name_assignment"], "not established")
        equal(finding["confidence"]["formal_naming_authority_verified"], False)
        equal(finding["confidence"]["numerical_probability_claimed"], False)

    prior = continuity["previous_aw_ids_in_index_order"]
    equal(continuity["previous_target_count"], 57)
    equal(len(prior), 57)
    equal(len(set(prior)), 57)
    assert not set(prior).intersection(IDS)
    equal(continuity["selected_aw_ids"], IDS)
    equal(continuity["intersection_aw_ids"], [])
    equal(continuity["selected_unique_count"], 3)
    for key in ("historical_names_used_as_identity_evidence", "pending_access_reassessment_performed", "scope_hold_reassessment_performed"):
        equal(continuity[key], False)
    equal(review["preserved_pending_access_ids"], ["lakes_base:1159112821", "lakes_base:1159108815"])
    for key in ("preserved_pending_access_ids", "preserved_scope_hold_ids"):
        equal(review[key], continuity[key])
        assert set(review[key]).issubset(prior)
        equal(len(review[key]), len(set(review[key])))
    equal(len(review["preserved_scope_hold_ids"]), 17)
    delta = continuity["current_batch_delta"]
    for key, expected in {
        "selected_current_inventory_targets": 3, "reconstructed_target_count_before": 57,
        "reconstructed_target_count_after": 60, "initial_eligible_target_count": 4065,
        "remaining_fresh_reconstruction_queue_before": 4008, "remaining_fresh_reconstruction_queue_after": 4005,
        "remaining_queue_types_before": {"river_group": 3436, "lake": 572},
        "remaining_queue_types_after": {"river_group": 3433, "lake": 572},
        "historically_never_reviewed_count_claimed": False,
        "prior_target_geometry_or_naming_revalidation_performed": False,
    }.items():
        equal(delta[key], expected)
    inherited = review["inherited_scope_continuity"]
    equal([r["aw_id"] for r in inherited], ["lakes_base:1159109723", "lakes_base:1159116675", "lakes_base:1159118183", "lakes_base:1159118201"])
    equal([r["candidate_name"] for r in inherited], ["Sandfly Lake", "Lake Ohrid", "Prespa Lake", None])
    equal([r["research_category"] for r in inherited], ["supported_generalized_water_identity", "candidate_waterbody_identity_extent_hold", "candidate_waterbody_identity_extent_hold", "whole_polygon_scope_hold"])
    equal([r["follow_up_required"] for r in inherited], [False, True, True, True])
    assert "eastern basin" in inherited[0]["supported_name_scope"]
    for row in inherited[1:]:
        equal(row["naming_scope_details"]["directly_supported_name_forms"], [])
    return {
        "status": "passed", "mode": "included_public_files_only", "scope_aw_ids": IDS,
        "recorded_fragment_count": 3, "recorded_part_count": 159, "recorded_position_count": 1068,
        "recorded_full_feature_correspondence_reviews_completed": 3,
        "representative_system_identities_supported": 3, "current_source_limited_targets": 0,
        "current_scope_hold_ids": [], "current_follow_up_ids": [],
        "recorded_prior_target_count": 57, "current_batch_increment": 3,
        "recorded_cumulative_distinct_targets": 60, "remaining_unrecorded_targets": 4005,
        "remaining_river_groups": 3433, "remaining_lakes": 572,
        "preserved_pending_access_ids": review["preserved_pending_access_ids"],
        "preserved_scope_hold_ids": review["preserved_scope_hold_ids"],
        "distinct_supporting_publications": 1, "independent_source_groups": 1,
        "original_source_material_reopened": False, "map_judgments_reproduced": False,
        "omitted_full_paths_recomputed": False, "original_decoder_replayed": False,
        "prior_target_source_or_geometry_reaudit_performed": False,
        "formal_registry_verified": False, "all_reach_names_verified": False,
        "scalar_product_name_approvals": 0, "automatic_application": False,
        "product_application": False, "network_requests": 0,
        "future_reach_level_naming_requires_separate_evidence": True,
        "limit": "Included-file consistency only. Historical original-map, complete-path and decoder review is recorded, not reproduced. Representative identity does not name every reach or authorize product application.",
    }


def validate_public():
    pins = read_json(HERE / "public-input-pins.json")
    equal(pins["batch"], "r20")
    equal(pins["scope"], "included_public_files_only")
    equal(pins["automatic_application"], False)
    equal(sorted(row["path"] for row in pins["files"]), sorted(GEOMETRY_FILES))
    equal(len(pins["files"]), len(GEOMETRY_FILES))
    for row in pins["files"]:
        file = PUBLIC / row["path"]
        assert not file.is_symlink()
        verify_bytes(file.read_bytes(), row)
    geometry_manifest = read_json(PUBLIC / "geometry-component-manifest.json")
    equal(sorted(geometry_manifest["files"]), sorted(GEOMETRY_FILES - {"geometry-component-manifest.json"}))
    for name, digest in geometry_manifest["files"].items():
        equal(hashlib.sha256((PUBLIC / name).read_bytes()).hexdigest(), digest)
    manifest = read_json(HERE / "review-manifest.json")
    equal(manifest["batch"], "r20")
    equal(manifest["scope"], "included_public_files_only")
    equal(manifest["scope_aw_ids"], IDS)
    equal(manifest["review_file_count_including_manifest"], 8)
    equal(manifest["manifest_excludes_itself"], True)
    equal(manifest["automatic_application"], False)
    equal(sorted(p.name for p in HERE.iterdir()), sorted(REVIEW_FILES))
    equal(sorted(row["file"] for row in manifest["files"]), sorted(REVIEW_FILES - {"review-manifest.json"}))
    equal(len(manifest["files"]), 7)
    for row in manifest["files"]:
        file = HERE / row["file"]
        assert file.is_file() and not file.is_symlink()
        verify_bytes(file.read_bytes(), row)
    result = validate_records(load_records())
    recorded = read_json(HERE / "review-validation.json")
    equal(recorded["validation"], result)
    equal(recorded["status"], "passed")
    equal(recorded["mode"], "included_public_files_only")
    equal(recorded["tests"]["status"], "passed")
    result["public_input_files_checked"] = len(GEOMETRY_FILES)
    result["review_component_files_checked"] = len(REVIEW_FILES)
    result["included_dependency_manifests_checked"] = 1
    return result


if __name__ == "__main__":
    print(json.dumps(validate_public(), indent=2))
