#!/usr/bin/env python3
"""Read-only 10-system independent named-station vs Pando HydroRIVERS audit.

A reported distance is the minimum between one independently named station
point and the published, geometrically generalized Hydro mainstem. It is NOT
the percentage of a river validated, full-line identity, or ODbL clearance.
Only hydrology and vetted coordinate metadata are used, not OSM.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

BATCH = (
    "10521208", "10526283", "20071308", "20075401", "20282318",
    "20456598", "20532766", "20540915", "20561290", "20565620"
)

CHAD = "https://horizon.documentation.ird.fr/exl-doc/pleins_textes/2021-08/010082147.pdf"
POLAND = "https://danepubliczne.imgw.pl/api/data/hydro/format/html"
GEORGIA = "https://eu4waterdata.eu/images/pdf/library/UBA/EU4EnvWD_A1.4.1_GE_SW_Survey_Report_2022_ENG.pdf"
FIN_OULU = "https://finto.fi/yso-paikat/fi/page/p204727"
FIN_SIIKA = "https://finto.fi/yso-paikat/en/page/p139542"
EMBA = "https://silkadv.com/ru/node/4653"
URAL = "https://silkadv.com/en/content/ural-river-kazakhstan"
SULAK = "https://www.mdpi.com/2073-4441/17/23/3390"
TEREK = "https://waterresources.ru/reki/terek/"

# Records copied verbatim from individually cited independent measurement
# registers. Georgian coordinates are degree+decimal-minute (not DMS).
# The reported Manda basin label in the 2021 publication is "Chari" but
# Chad's national hydrometeorological authority identifies the watercourse
# at Manda as Bahr Sara. Treat as tributary, NOT a Chari-name observation.
ROWS = [
    ("chari_sarh", "Chari", 18.41, 9.15, CHAD, "Chad DRE 1460200118 at Sarh"),
    ("chari_bousso", "Chari", 16.71, 10.50, CHAD, "Chad DRE 1460200106 at Bousso"),
    ("chari_mailao", "Chari", 15.28, 11.60, CHAD, "Chad DRE 1460200133 at Mailao"),
    ("chari_ndjamena", "Chari/Logone", 15.03, 12.11, CHAD, "Chad DRE 1460200121 confluence reach"),
    ("bahr_sara_manda", "Bahr Sara (Chari tributary)", 18.20, 9.18, CHAD, "Chad DRE 1460201903 Manda; watercourse label disputed"),
    ("logone_bongor", "Logone", 15.41, 10.26, CHAD, "Chad DRE 1460300112 Bongor"),
    ("logone_gana", "Logone", 15.15, 11.55, CHAD, "Chad DRE 1460300163 Logone-Gana"),
    ("nls_oulujoki", "Oulujoki", 25.56374, 64.99977, FIN_OULU, "Finland NLS registered named watercourse location"),
    ("nls_siikajoki", "Siikajoki", 24.74333, 64.83728, FIN_SIIKA, "Finland NLS registered named watercourse location"),
    ("imgw_odra_trestno", "Odra", 17.1469, 51.0822, POLAND, "IMGW 151170030 Trestno"),
    ("imgw_odra_glogow", "Odra", 16.0592, 51.6739, POLAND, "IMGW 151160060 Glogow"),
    ("imgw_odra_kostrzyn", "Odra", 14.6106, 52.5992, POLAND, "IMGW 152140060 Kostrzyn"),
    ("imgw_odra_gozdowice", "Odra", 14.3178, 52.7642, POLAND, "IMGW 152140020 Gozdowice"),
    ("imgw_warta_kostrzyn", "Warta", 14.6622, 52.5819, POLAND, "IMGW 152140070 Kostrzyn"),
    ("imgw_warta_skwierzyna", "Warta", 15.5003, 52.6019, POLAND, "IMGW 152150110 Skwierzyna"),
    ("imgw_warta_swierkocin", "Warta", 14.9994, 52.6506, POLAND, "IMGW 152150010 Swierkocin"),
    ("atlas_zhem", "Zhem/Emba", 56.39972222222222, 47.87388888888889, EMBA, "secondary geographic point transcription, not government GIS"),
    ("atlas_ural", "Zhaiyk/Ural", 51.58833333333334, 49.577222222222225, URAL, "secondary geographic point transcription, not government GIS"),
    ("sulak_field_01", "Sulak", 47.537988, 43.259126, SULAK, "2024 independent field sampling"),
    ("sulak_field_02", "Sulak", 47.1130054, 43.3657051, SULAK, "2024 independent field sampling"),
    ("terek_mouth", "Terek", 47.55972222222222, 43.59527777777778, TEREK, "secondary Russian river gazetteer"),
    ("rioni_oni", "Rioni", 43+26.003/60, 42+34.896/60, GEORGIA, "NEA EU4Environment 2022 site 4"),
    ("rioni_utsera", "Rioni", 43+33.166/60, 42+38.927/60, GEORGIA, "NEA EU4Environment 2022 site 5"),
    ("rioni_khidikari", "Rioni", 43+11.291/60, 42+31.882/60, GEORGIA, "NEA EU4Environment 2022 site 8"),
    ("rioni_alpana", "Rioni", 42+50.536/60, 42+33.736/60, GEORGIA, "NEA EU4Environment 2022 site 10"),
    ("tskh_lentekhi", "Tskhenistskali", 42+43.335/60, 42+46.972/60, GEORGIA, "NEA EU4Environment 2022 site 11"),
    ("tskh_luji", "Tskhenistskali", 42+57.119/60, 42+49.605/60, GEORGIA, "NEA EU4Environment 2022 site 12"),
    ("kvirila_sachkhere", "Kvirila", 43+24.513/60, 42+20.175/60, GEORGIA, "NEA EU4Environment 2022 site 1"),
    ("kvirila_chiatura", "Kvirila", 43+16.674/60, 42+17.118/60, GEORGIA, "NEA EU4Environment 2022 site 2"),
    ("jejora_oni", "Jejora", 43+25.796/60, 42+34.429/60, GEORGIA, "NEA EU4Environment 2022 site 3"),
    ("krikhula_ambrolauri", "Krikhula", 43+8.933/60, 42+31.302/60, GEORGIA, "NEA EU4Environment 2022 site 9"),
    ("enguri_vichnishi", "Enguri", 42+54.218/60, 42+56.510/60, GEORGIA, "NEA EU4Environment 2022 site 14"),
    ("enguri_mestia", "Enguri", 42+44.876/60, 43+4.523/60, GEORGIA, "NEA EU4Environment 2022 site 15"),
    ("enguri_potskho", "Enguri", 42+1.727/60, 42+43.774/60, GEORGIA, "NEA EU4Environment 2022 site 19"),
    ("enguri_khaishi", "Enguri", 42+10.692/60, 42+56.693/60, GEORGIA, "NEA EU4Environment 2022 site 20"),
    ("enguri_anaklia_mouth", "Enguri", 41+33.614/60, 42+23.535/60, GEORGIA, "NEA EU4Environment 2022 site 24"),
    ("dolra_ushkhvani", "Dolra (Enguri tributary)", 42+36.143/60, 43+2.671/60, GEORGIA, "NEA EU4Environment 2022 site 16"),
    ("nakra_intake", "Nakra (Enguri tributary)", 42+22.822/60, 43+4.184/60, GEORGIA, "NEA EU4Environment 2022 site 17"),
    ("nenskra_marghi", "Nenskra (Enguri tributary)", 42+11.403/60, 43+1.100/60, GEORGIA, "NEA EU4Environment 2022 site 18"),
    ("chanistskali_jikhashkari", "Chanistskali (Enguri tributary)", 42+1.507/60, 42+29.785/60, GEORGIA, "NEA EU4Environment 2022 site 21"),
    ("chkhoushia_zugdidi", "Chkhoushia (Enguri tributary)", 41+50.793/60, 42+29.428/60, GEORGIA, "NEA EU4Environment 2022 site 22"),
    ("jumi_darcheli", "Jumi (Enguri tributary)", 41+40.852/60, 42+25.800/60, GEORGIA, "NEA EU4Environment 2022 site 23"),
    ("khobistskali_gamogma", "Khobistskali", 41+50.293/60, 42+16.371/60, GEORGIA, "NEA EU4Environment 2022 site 25"),
    ("khobistskali_khobi", "Khobistskali", 41+54.586/60, 42+18.804/60, GEORGIA, "NEA EU4Environment 2022 site 26"),
]
POINTS = {row[0]: {"id":row[0], "river":row[1], "lon":row[2], "lat":row[3],
                   "source":row[4], "description":row[5]} for row in ROWS}
GROUPS = {
    "10521208": [k for k in POINTS if k.startswith(("chari_", "bahr_", "logone_"))],
    "10526283": [k for k in POINTS if k.startswith(("chari_", "bahr_", "logone_"))],
    "20071308": ["nls_oulujoki", "nls_siikajoki"],
    "20075401": ["nls_oulujoki", "nls_siikajoki"],
    "20282318": [k for k in POINTS if k.startswith("imgw_")],
    "20456598": ["atlas_zhem", "atlas_ural"],
    "20532766": ["sulak_field_01", "sulak_field_02", "terek_mouth"],
    "20540915": ["sulak_field_01", "sulak_field_02", "terek_mouth"],
    "20561290": [k for k in POINTS if k.startswith(("rioni_", "tskh_", "kvirila_", "jejora_", "krikhula_", "enguri_", "dolra_", "nakra_", "nenskra_", "chanistskali_", "chkhoushia_", "jumi_", "khobistskali_"))],
    "20565620": [k for k in POINTS if k.startswith(("rioni_", "tskh_", "kvirila_", "jejora_", "krikhula_", "enguri_", "dolra_", "nakra_", "nenskra_", "chanistskali_", "chkhoushia_", "jumi_", "khobistskali_"))],
}
CRS = {
    "10521208": "EPSG:32633", "10526283": "EPSG:32633",
    "20071308": "EPSG:32635", "20075401": "EPSG:32635",
    "20282318": "EPSG:32633",
    "20456598": "EPSG:32640",
    "20532766": "EPSG:32638", "20540915": "EPSG:32638",
    "20561290": "EPSG:32638", "20565620": "EPSG:32638",
}

def separate_lines(geometry):
    kind = geometry.get("type")
    if kind == "LineString":
        return [geometry.get("coordinates") or []]
    if kind == "MultiLineString":
        return geometry.get("coordinates") or []
    raise ValueError("Unexpected geom: " + str(kind))


def audit(decoded):
    from shapely.geometry import LineString, Point
    from shapely.ops import transform
    from pyproj import Transformer

    original = decoded["manifest"]
    if original.get("version") != "0.13.2" or original["metadata"].get("featureCount") != 16548:
        raise ValueError("Expected original 0.13.2 published feature set")
    features = {sid: [] for sid in BATCH}
    for row in decoded["features"]:
        md=row["metadata"]
        sid=str(md.get("systemId") or "")
        if sid in features and md.get("role") == "mainstem":
            features[sid].append(row)
    if any(not values for values in features.values()):
        raise ValueError("One or more first-ten mainstems missing")
    results=[]
    for sid in BATCH:
        projection = Transformer.from_crs("EPSG:4326", CRS[sid], always_xy=True)
        back = Transformer.from_crs(CRS[sid], "EPSG:4326", always_xy=True)
        lines=[]
        for feature in features[sid]:
            for coords in separate_lines(feature["geometry"]):
                if len(coords)>1:
                    line=transform(projection.transform,LineString(coords))
                    if not line.is_empty and line.length>0: lines.append(line)
        if not lines:
            raise ValueError("No line segments for "+sid)
        stations=[]
        for key in GROUPS[sid]:
            info=POINTS[key]
            pt=transform(projection.transform,Point(info["lon"],info["lat"]))
            closest=min((line.interpolate(line.project(pt)) for line in lines),
                        key=lambda candidate:pt.distance(candidate))
            lon,lat=back.transform(closest.x,closest.y)
            stations.append({
                "id":key,"river":info["river"],
                "publishedPointLonLat":[round(info["lon"],7),round(info["lat"],7)],
                "distanceToMainstemKm":round(pt.distance(closest)/1000,3),
                "nearestHydroLonLat":[round(lon,6),round(lat,6)],
                "independentSource":info["source"],"stationDescription":info["description"],
            })
        results.append({
          "systemId":sid, "publishedNameKo":features[sid][0]["metadata"]["name"],
          "mainstemFeatureCount":len(features[sid]),"linePartCount":len(lines),
          "mainstemLengthKm":round(sum(line.length for line in lines)/1000,3),
          "independentStations":stations,
          "minDistanceKmByRiver":{name:min(s["distanceToMainstemKm"] for s in stations if s["river"]==name)
             for name in sorted(set(s["river"] for s in stations))},
        })
    return {
       "schema":"pando-hydro-osm-remaining-first10-point-check-v1",
       "baselineHydroVersion":"v0.13.2",
       "publishedHydroBundleSha256":original["container"]["sha256"],
       "metadataNotModified":True,"osmSourcesNotUsed":True,
       "method":"independent named-station/point to all preexisting Pando Hydro mainstem polyline segments in local UTM",
       "limits":[
        "Point-to-line proximity is a screening metric, not whole river identity or a license substitution.",
        "Multiple named tributaries may belong to one grouped logical Hydro basin.",
        "NLS register locations are named point references, not whole 107km Oulujoki or 194km Siikajoki vectors.",
        "Terek/Ural comparison points came from secondary gazetteers; country official polyline is pending.",
        "Chad Manda is listed under Chari basin by a 2021 paper, but Bahr Sara by national hydrometeorology."
       ],
       "items":results
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--decoded",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    report=audit(json.loads(args.decoded.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("OSM_BATCH01_ANCHORS="+json.dumps({"items":[
       {"systemId":x["systemId"],"publishedNameKo":x["publishedNameKo"],
        "mainstemLengthKm":x["mainstemLengthKm"],"minDistanceKmByRiver":x["minDistanceKmByRiver"],
        "stations":[[y["id"],y["distanceToMainstemKm"]] for y in x["independentStations"]]}
       for x in report["items"]]},ensure_ascii=False,separators=(",",":")),flush=True)

if __name__=="__main__":
    main()
