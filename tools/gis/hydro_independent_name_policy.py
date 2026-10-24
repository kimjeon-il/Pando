"""Validated non-OSM hydronym corrections for the canonical HydroRIVERS generator.

This is an incremental pipeline contract. It does not rewrite deployed maps.
Use no OpenStreetMap-derived geometries, names, relation identifiers, or
translations for explicitly independently reviewed system IDs.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^[1-9][0-9]+$")


def load_independent_hydronyms(path: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1 or not isinstance(payload.get("replacements"), list):
        raise ValueError("Invalid independent hydronym verification schema")
    verified = {}
    for item in payload["replacements"]:
        if not isinstance(item, dict):
            raise ValueError("Independent hydronym entry must be an object")
        system_id = str(item.get("systemId") or "")
        if not ID_RE.fullmatch(system_id) or system_id in verified:
            raise ValueError("Invalid or repeated independent hydronym system ID")
        korean_name = item.get("nameKo")
        if not isinstance(korean_name, str) or not re.search(r"[가-힣]", korean_name):
            raise ValueError(f"Missing verified Korean name for system {system_id}")
        for key in ("aliases", "tributaryNames"):
            if not isinstance(item.get(key), list) or any(
                not isinstance(value, str) or not value.strip() or value == korean_name
                for value in item[key]
            ):
                raise ValueError(f"Invalid verified {key} for system {system_id}")
        geom = item.get("naturalEarth")
        coverage = geom.get("sampleCoverage") if isinstance(geom, dict) else None
        natural_earth_valid = (isinstance(geom, dict) and isinstance(geom.get("name"), str)
                               and bool(geom["name"]) and isinstance(coverage, (int, float))
                               and 0.85 <= coverage <= 1.0)
        # Natural Earth omits some named tributaries. For those, independently
        # labelled USGS gauging stations must match the actual HydroRIVERS
        # mainstem and be well separated from a competing watercourse.
        gauges = item.get("officialStationEvidence")
        station_valid = False
        if isinstance(gauges, dict):
            station_ids = gauges.get("stationIds")
            station_valid = (
                gauges.get("agency") == "USGS"
                and isinstance(station_ids, list)
                and len(station_ids) >= 3
                and len(set(station_ids)) == len(station_ids)
                and all(isinstance(code, str) and code.startswith("USGS-") for code in station_ids)
                and isinstance(gauges.get("maximumMatchingStationDistanceKm"), (int, float))
                and 0 <= gauges["maximumMatchingStationDistanceKm"] <= 1.0
                and isinstance(gauges.get("nearestDifferentBasinStationKm"), (int, float))
                and gauges["nearestDifferentBasinStationKm"] >= 20.0
                and isinstance(gauges.get("checkedAgainstSystemId"), str)
                and gauges["checkedAgainstSystemId"] != system_id
            )
        # Smaller named reaches within a correctly labelled basin need a
        # stricter, separately audited low-coverage exception. It is limited
        # to preserving an already-published name, with government material,
        # an independently named Natural Earth mainstem, and no competing NE
        # watercourse of comparable reach.
        conservative = item.get("conservativeMainstemReview")
        conservative_valid = (
            isinstance(conservative, dict)
            and conservative.get("method") == "official-corroborated-original-name"
            and item.get("previousNameKo") == korean_name
            and isinstance(geom, dict)
            and isinstance(geom.get("name"), str) and bool(geom["name"])
            and isinstance(coverage, (int, float)) and 0.70 <= coverage < 0.85
            and isinstance(conservative.get("otherNamedNECoverage"), (int, float))
            and 0 <= conservative["otherNamedNECoverage"] < 0.15
            and isinstance(conservative.get("reason"), str)
            and len(conservative["reason"]) >= 24
        )
        # Some logical HydroRIVERS networks have mainstem chains extending
        # through named major tributaries. Preserve the established basin label
        # only if both line names independently match the actual geometry and
        # governmental basin management confirms their confluence.
        confluence = item.get("basinConfluenceReview")
        confluence_valid = (
            isinstance(confluence, dict)
            and confluence.get("method") == "official-basin-named-confluence"
            and item.get("previousNameKo") == korean_name
            and isinstance(geom, dict) and bool(geom.get("name"))
            and isinstance(coverage, (int, float)) and 0.35 <= coverage < 0.85
            and isinstance(confluence.get("namedTributaryNE"), str)
            and bool(confluence["namedTributaryNE"])
            and confluence["namedTributaryNE"] != geom["name"]
            and isinstance(confluence.get("tributarySampleCoverage"), (int, float))
            and 0.19 <= confluence["tributarySampleCoverage"] < 1.0
            and coverage + confluence["tributarySampleCoverage"] >= 0.75
            and isinstance(confluence.get("reason"), str)
            and len(confluence["reason"]) >= 40
        )
        # Rename a falsely identified logical river network only when an
        # independent government river authority establishes the source-name
        # mismatch, and two separately named Natural Earth reaches align
        # with the correct downstream basin.
        renamed_basin = item.get("independentBasinRename")
        rename_valid = (
            isinstance(renamed_basin, dict)
            and renamed_basin.get("method") == "independent-government-basin-rename"
            and item.get("previousNameKo") != korean_name
            and isinstance(geom, dict) and bool(geom.get("name"))
            and isinstance(coverage, (int, float)) and coverage >= 0.5
            and isinstance(renamed_basin.get("namedTributaryNE"), str)
            and renamed_basin["namedTributaryNE"] != geom["name"]
            and isinstance(renamed_basin.get("tributarySampleCoverage"), (int, float))
            and renamed_basin["tributarySampleCoverage"] >= 0.3
            and coverage + renamed_basin["tributarySampleCoverage"] >= 0.9
            and isinstance(renamed_basin.get("sourceErroneousTributaryName"), str)
            and len(renamed_basin["sourceErroneousTributaryName"]) >= 3
            and isinstance(renamed_basin.get("reason"), str)
            and len(renamed_basin["reason"]) >= 100
        )
        # For already correctly named rivers whose HydroRIVERS selected
        # reach extends beyond sparse 1:10m Natural Earth coverage, accept
        # an independently documented official mainstem only if no other
        # named reference river competes with it anywhere on the audit path.
        partial = item.get("partialExistingNameReview")
        partial_valid = (
            isinstance(partial, dict)
            and partial.get("method") == "government-confirmed-existing-mainstem-no-independent-rival"
            and item.get("previousNameKo") == korean_name
            and isinstance(geom, dict) and bool(geom.get("name"))
            and isinstance(coverage, (int, float)) and 0.45 <= coverage < 0.70
            and isinstance(partial.get("strongestOtherNENameCoverage"), (float, int))
            and 0 <= partial["strongestOtherNENameCoverage"] <= 0.05
            and isinstance(partial.get("reason"), str) and len(partial["reason"]) >= 100
        )
        # Official named state-supplied river vector is an independent way to
        # verify basins missing from Natural Earth's named line reference.
        # Geometry is compared offline and never copied into runtime assets.
        gov_vector = item.get("officialGovernmentVectorEvidence")
        gov_vector_valid = (
            isinstance(gov_vector, dict)
            and gov_vector.get("method") == "official-government-polyline-confirmation"
            and item.get("previousNameKo") == korean_name
            and isinstance(gov_vector.get("namedFeature"), str)
            and bool(gov_vector["namedFeature"])
            and isinstance(gov_vector.get("referenceLayer"), str)
            and gov_vector["referenceLayer"].startswith("https://")
            and isinstance(gov_vector.get("sourceGeoJSONSha256"), str)
            and bool(re.fullmatch(r"[0-9a-f]{64}", gov_vector["sourceGeoJSONSha256"]))
            and isinstance(gov_vector.get("hydroMainstemSamples"), int)
            and gov_vector["hydroMainstemSamples"] >= 100
            and isinstance(gov_vector.get("within1kmHydroToGovernment"), (float,int))
            and 0.95 <= gov_vector["within1kmHydroToGovernment"] <= 1
            and isinstance(gov_vector.get("within1kmGovernmentToHydro"), (float,int))
            and 0.85 <= gov_vector["within1kmGovernmentToHydro"] <= 1
            and isinstance(gov_vector.get("p90DistanceKm"), (float,int))
            and 0 <= gov_vector["p90DistanceKm"] <= 0.75
        )
        # Cross-border rivers often have substantial name-free gaps in the
        # simplified Natural Earth network. Retain the existing name only
        # after two adjacent states have independently identified it.
        cross_border = item.get("crossBorderNameReview")
        cross_border_valid = (
            isinstance(cross_border, dict)
            and cross_border.get("method") == "bulgarian-greek-institutional-mainstem-confirmation"
            and item.get("previousNameKo") == korean_name
            and isinstance(geom, dict) and bool(geom.get("name"))
            and isinstance(coverage, (float,int)) and 0.35 <= coverage < 0.45
            and isinstance(cross_border.get("strongestOtherNENameCoverage"), (float,int))
            and 0 <= cross_border["strongestOtherNENameCoverage"] <= 0.05
            and isinstance(cross_border.get("reason"), str)
            and len(cross_border["reason"]) >= 160
        )
        if not any((natural_earth_valid, station_valid, conservative_valid, confluence_valid,
                    rename_valid, partial_valid, gov_vector_valid, cross_border_valid)):
            raise ValueError(f"Missing independent mainstem evidence for system {system_id}")
        evidence = item.get("independentSources")
        if not isinstance(evidence, list) or len(evidence) < 2:
            raise ValueError(f"Missing multiple independent references for system {system_id}")
        kinds = set()
        for source in evidence:
            if not isinstance(source, dict):
                raise ValueError(f"Invalid independent source for system {system_id}")
            url = source.get("url")
            kind = source.get("kind")
            if not isinstance(url, str) or not url.startswith("https://") or not isinstance(kind, str):
                raise ValueError(f"Invalid independent source URL for system {system_id}")
            if "openstreetmap" in url.casefold() or "overpass" in url.casefold() or kind.lower() == "osm":
                raise ValueError(f"OSM cannot be a replacement source for system {system_id}")
            kinds.add(kind)
        independent_vector = "public-domain-vector" in kinds and len(kinds) >= 2
        independent_gauges = station_valid and {"government-hydrology", "government-gauging"} <= kinds
        if conservative_valid and not ({"government-hydrology", "public-domain-vector"} <= kinds):
            raise ValueError(f"Official river authority needed for conservative mainstem {system_id}")
        if confluence_valid and not (
            "public-domain-vector" in kinds
            and bool(kinds & {"government-hydrology", "multilateral-basin-agency"})
        ):
            raise ValueError(f"Government or intergovernmental river basin authority needed for {system_id}")
        if rename_valid and not ({"public-domain-vector", "government-hydrology", "government-ministry-geography", "government-river-identification"} <= kinds):
            raise ValueError(f"Multiple independent government sources needed for river rename {system_id}")
        if partial_valid and not (
            "public-domain-vector" in kinds
            and "government-hydrology" in kinds
            and bool(kinds & {"government-river-monitoring", "government-river-atlas"})
        ):
            raise ValueError(f"Two official, name-specific institutional references needed for partial mainstem {system_id}")
        official_vector_sources = {"government-river-vector", "government-river-authority", "government-open-data-license"}
        if gov_vector_valid and not official_vector_sources <= kinds:
            raise ValueError(f"Government vector, authority and license missing for {system_id}")
        if cross_border_valid and not {"public-domain-vector", "government-hydrology", "government-crossborder-hydrology", "international-crossborder-programme"} <= kinds:
            raise ValueError(f"Two adjacent governments and separate regional source required for {system_id}")
        if not independent_vector and not independent_gauges and not gov_vector_valid:
            raise ValueError(f"Independent geodata and named hydrology evidence required for {system_id}")
        if not any((natural_earth_valid, independent_gauges, conservative_valid, confluence_valid,
                    rename_valid, partial_valid, gov_vector_valid, cross_border_valid)):
            raise ValueError(f"Missing verified independent mainstem corroboration for {system_id}")
        verified[system_id] = item
    return verified
