#!/usr/bin/env python3
"""Bounded tests of included records; no original-map or full-path replay."""
import copy
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def run_tests():
    validator = HERE / "validate-independent-review.py"
    assert validator.is_file(), "The included-file review validator is required"
    spec = importlib.util.spec_from_file_location("review_validator", validator)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    baseline = module.validate_records(module.load_records())
    assert baseline["status"] == "passed"
    assert baseline["recorded_position_count"] == 1530
    assert baseline["original_source_material_reopened"] is False

    # Each mutation names a materially different public-record failure.
    cases = [
        ("target_order", "review", ("scope_aw_ids", 0), "hydro-system:50781500"),
        ("geometry_domain", "review", ("findings", 0, "logical_fid"), 6998),
        ("incomplete_group", "metadata", ("fragments", 1, "part_count"), 25),
        ("wrong_position_count", "source", ("complete_group_observations", 2, "position_count"), 427),
        ("missing_direct_name", "review", ("findings", 0, "directly_supported_name_forms"), []),
        ("uniform_group_name", "review", ("findings", 1, "uniform_river_name_for_group"), True),
        ("scalar_application", "review", ("findings", 2, "scalar_product_name"), "Shoalhaven River"),
        ("future_evidence_requirement_erased", "review", ("findings", 1, "reach_level_naming_follow_up_required_before_product_application"), False),
        ("catchment_title_as_sole_evidence", "review", ("findings", 2, "catchment_title_alone_used_as_identity"), True),
        ("access_status_changed", "review", ("findings", 0, "source_access_limited"), True),
        ("historical_review_claimed_replayed", "review", ("historical_review", "historical_results_recomputed_by_public_validator"), True),
        ("omitted_geometry_claimed_included", "review", ("historical_review", "full_selected_geometry_included"), True),
        ("publication_views_double_counted", "source", ("distinct_supporting_publications",), 2),
        ("publication_year_confused", "source", ("observations", 0, "publication_year"), 2012),
        ("false_new_acquisition", "source", ("observations", 0, "retrieved_this_batch"), True),
        ("wrong_direct_label_page", "source", ("observations", 0, "figures", 3, "physical_pdf_page"), 81),
        ("source_link_broken", "review", ("findings", 1, "source_keys"), ["unrecorded_source"]),
        ("formal_registry_upgrade", "source", ("formal_registry_verified",), True),
        ("scope_observation_erased", "source", ("complete_group_observations", 1, "independent_observation"), "Hunter River applies to all reaches."),
        ("prior_membership_duplicate", "continuity", ("previous_aw_ids_in_index_order", 0), "hydro-system:50701991"),
        ("pending_access_erased", "review", ("preserved_pending_access_ids",), []),
        ("prior_hold_erased", "review", ("preserved_scope_hold_ids",), []),
        ("inherited_candidate_upgraded", "review", ("inherited_scope_continuity", 1, "research_category"), "supported_generalized_water_identity"),
        ("remaining_delta_wrong", "continuity", ("current_batch_delta", "remaining_fresh_reconstruction_queue_after"), 4001),
        ("raw_geometry_added", "review", ("findings", 0, "coordinates"), [[1, 2], [3, 4]]),
        ("omitted_input_fingerprint_added", "source", ("original_body_sha256",), "0" * 64),
        ("second_fragment_erased", "review", ("findings", 0, "geometry_fids"), [6998]),
        ("stage_two_erased", "metadata", ("fragments", 1, "stage"), 3),
        ("feeder_distinction_erased", "review", ("findings", 1, "regional_distinct_channel_associations"), []),
        ("exact_feeder_reaches_claimed", "review", ("findings", 1, "regional_associations_are_exact_reach_assignments"), True),
        ("unverified_korean_name", "review", ("findings", 2, "name_ko"), "unverified"),
        ("invalid_public_timestamp", "geometry", ("created_at_utc",), "2026-10-09T18:60:00Z"),
        ("numeric_sites_called_names", "source", ("observations", 0, "figures", 2, "scope"), "Named station identity evidence"),
        ("mapped_short_name_erased", "review", ("findings", 1, "mapped_short_name_forms"), ["Hunter"]),
    ]
    rejected = []
    for name, document, path, replacement in cases:
        records = copy.deepcopy(module.load_records())
        target = records[document]
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = replacement
        try:
            module.validate_records(records)
        except (AssertionError, KeyError, TypeError, ValueError):
            rejected.append(name)
        else:
            raise AssertionError("Mutation accepted: " + name)
    try:
        module.verify_bytes(b"changed included file", {"bytes": 1, "sha256": "0" * 64})
    except AssertionError:
        rejected.append("included_file_integrity")
    else:
        raise AssertionError("Altered included bytes accepted")
    return {
        "status": "passed",
        "mode": "included_public_files_only",
        "semantic_and_integrity_mutations_rejected": rejected,
        "network_requests": 0,
        "original_map_or_full_path_or_decoder_judgments_reproduced": False,
        "limit": "Current public records and file integrity only. These tests do not confirm map interpretation or repeat original decoding.",
    }


if __name__ == "__main__":
    print(json.dumps(run_tests(), indent=2))
