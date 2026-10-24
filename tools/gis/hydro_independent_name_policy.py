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
        if not isinstance(geom, dict) or not isinstance(geom.get("name"), str) or not geom["name"]:
            raise ValueError(f"Missing Natural Earth candidate for system {system_id}")
        coverage = geom.get("sampleCoverage")
        if not isinstance(coverage, (float, int)) or not 0.85 <= coverage <= 1.0:
            raise ValueError(f"Insufficient independent mainstem sampling for system {system_id}")
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
        if "public-domain-vector" not in kinds or len(kinds) < 2:
            raise ValueError(f"Natural Earth and other independent reference required for {system_id}")
        verified[system_id] = item
    return verified
