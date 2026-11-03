/** Kazakhstan's 2019-ratified Baikonur lease amendment: official *research* geometries.
 * These exclusion polygons are NOT an independently surveyed Syr Darya riverbank,
 * nor a complete replacement for the existing country/lease polygon.
 * Source: https://old.adilet.zan.kz/rus/docs/Z1900000282 (effective 2020-01-22).
 */
export const BAIKONUR_2019_RATIFICATION='2019-12-25';
export const BAIKONUR_2019_EFFECTIVE='2020-01-22';
export const BAIKONUR_2019_OFFICIAL_URL='https://old.adilet.zan.kz/rus/docs/Z1900000282';
export const BAIKONUR_2017_OFFICIAL_URL='https://old.adilet.zan.kz/rus/docs/P1700000697';
export const BAIKONUR_2019_KAZAKH_COMPARISON_URL='https://adilet.zan.kz/rus/docs/Z1900000282/compare';
export const BAIKONUR_2019_EXCLUSIONS=Object.freeze({
  '1-1':[
    ['45 44 14,16','63 01 05,00'],['45 41 16,51','63 13 48,98'],
    ['45 39 37,90','63 13 51,02'],['45 42 43,24','63 01 05,00'],
  ],
  '1-2':[
    ['45 41 34,71','63 21 29,13'],['45 41 36,73','63 22 29,58'],
    ['45 42 45,61','63 25 06,52'],['45 46 42,32','63 41 53,88'],
    ['45 46 25,54','63 44 17,04'],['45 46 11,37','63 44 51,15'],
    ['45 46 10,00','63 44 10,00'],['45 45 44,07','63 44 04,81'],
    ['45 45 54,28','63 42 30,53'],['45 45 53,98','63 42 06,05'],
    ['45 45 49,21','63 41 38,46'],['45 45 42,56','63 41 13,17'],
    ['45 45 07,63','63 39 28,71'],['45 44 51,95','63 38 44,48'],
    ['45 44 23,64','63 36 39,52'],['45 43 58,33','63 34 47,58'],
    ['45 43 38,19','63 33 20,27'],['45 43 24,76','63 32 19,61'],
    ['45 42 21,51','63 27 44,52'],['45 41 42,95','63 24 45,76'],
    ['45 41 03,04','63 21 42,12'],
  ],
  '1-3':[
    ['45 34 46,67','63 16 29,24'],['45 34 46,10','63 17 04,11'],
    ['45 34 45,48','63 17 41,00'],['45 34 45,16','63 17 59,69'],
    ['45 33 06,84','63 17 59,37'], // Russian 2019 typographical comma independently resolved from official 2017 and Kazakh 2019 texts.
    ['45 33 08,00','63 15 19,32'],['45 34 15,84','63 15 20,23'],
    ['45 34 12,17','63 15 56,25'],['45 34 08,95','63 16 27,31'],
  ],
  '1-4':[
    ['45 33 11,01','63 18 50,47'],['45 34 44,35','63 18 48,70'],
    ['45 34 43,83','63 19 20,21'],['45 34 43,21','63 19 58,95'],
    ['45 34 42,36','63 20 50,60'],['45 34 41,49','63 21 01,48'],
    ['45 33 04,45','63 21 00,49'],
  ],
});
function insist(ok,message){if(!ok)throw Error(message);}
export function parseOfficialFractionalDms(input){
  const raw=String(input||'').trim();
  const parts=/^(\d{1,3}) (\d{2}) (\d{2})(?:,(\d+))?$/.exec(raw);
  insist(parts,'Malformed treaty DMS; no inferred correction: '+raw);
  const deg=Number(parts[1]),min=Number(parts[2]),sec=Number(parts[3]+(parts[4]?'.'+parts[4]:''));
  insist(Number.isFinite(sec)&&min<60&&sec<60&&deg<=180,'Treaty DMS out of bounds: '+raw);
  return Number((deg+min/60+sec/3600).toFixed(9));
}
export function baikonur2019Exclusions(){
  const valid=[],unresolved=[];
  for(const [id,rows] of Object.entries(BAIKONUR_2019_EXCLUSIONS)){
    const rawCoordinates=rows.map(([latitude,longitude])=>({latitude,longitude}));
    const problems=[];const coords=[];
    for(const [index,[lat,lon]] of rows.entries()){
      try{coords.push([parseOfficialFractionalDms(lon),parseOfficialFractionalDms(lat)]);}
      catch(error){problems.push({point:index+1,latitude:lat,longitude:lon,problem:error.message});}
    }
    if(problems.length){
      unresolved.push({plot:id,rawCoordinates,problems,reason:'Official text transcription ambiguity; no inferred geometry'});
      continue;
    }
    insist(coords.length>=3,'Invalid treaty exclusion geometry');
    valid.push({
      type:'Feature',id:'baikonur-treaty-2019-exclusion-'+id,
      properties:{kind:'official-lease-exclusion',plot:id,sourceUrl:BAIKONUR_2019_OFFICIAL_URL,
        effectiveDate:BAIKONUR_2019_EFFECTIVE,geometryStatus:'research-only-unvalidated-topology'},
      geometry:{type:'Polygon',coordinates:[[...coords,coords[0]]]},
    });
  }
  return {
    type:'FeatureCollection',name:'Baikonur lease amendment 2019 — exclusions only',
    properties:{
      sourceUrl:BAIKONUR_2019_OFFICIAL_URL,
      independentOfficialCrosschecks:[BAIKONUR_2017_OFFICIAL_URL,BAIKONUR_2019_KAZAKH_COMPARISON_URL],
      correctedOfficialTextDiscrepancy:{plot:'1-3',point:5,
        erroneousRussianText:'45,33 06,84',verifiedLatitudeDms:'45 33 06,84',
        basis:'2017 Kazakhstan Government protocol and Kazakh 2019 ratification annex'},
      ratified:BAIKONUR_2019_RATIFICATION,
      effectiveDate:BAIKONUR_2019_EFFECTIVE,openStreetMapDataUsed:false,
      status:'RESEARCH_ONLY_NOT_FOR_RUNTIME',
      unresolvedPlots:unresolved,
      remaining:['Confirm official datum and surveyed coordinates against cadastral boundaries',
        'Digitize Tyuratam and Akay exclusions and road/rail exclusions',
        'Survey the two Syr Darya right-bank reaches without OSM',
        'Check polygons, datum, Kazakhstan-Baikonur shared topology and effective time'],
    },
    features:valid,
  };
}
