import {parseTemporal,compareTemporal} from "./temporal.js";
/** One canonical shape for a dated builtin map admitted as a project.
 * Date validity is checked by the source selector and the C++ document owner. */
export function createBuiltinProjectSetup(initialMonth) {
 return {initialMonth,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
}
export function normalizeProjectSetup(input) {
 if(!input||typeof input!=='object')throw new Error('시작 설정을 입력하세요.');
 const month=value=>{const point=parseTemporal(value,{nullable:false});if(point.precision!=='month')throw new Error('연·월을 입력하세요.');return point.canonical;};
 const initialMonth=month(input.initialMonth);let timelineRange=null;
 if(input.timelineRange){const start=month(input.timelineRange.start),end=month(input.timelineRange.end);if(compareTemporal(start,end)>0)throw new Error('탐색 종료 월은 시작 월 이후여야 합니다.');timelineRange={start,end};}
 const bounds=input.initialMapBounds;let initialMapBounds=null;
 if(bounds){const {west,east,south,north}=bounds;if(![west,east,south,north].every(Number.isFinite)||west< -180||west>180||east< -180||east>180||west===east||south< -90||north>90||south>=north)throw new Error('지도 범위를 다시 지정하세요.');initialMapBounds={west,east,south,north};}
 if(!['builtin','empty'].includes(input.sourceMode))throw new Error('시작 자료를 선택하세요.');
 const result={initialMonth,timelineRange,initialMapBounds,sourceMode:input.sourceMode};requireProjectMonth(result,initialMonth);return result;
}
export function requireProjectMonth(setup,month) {
 const range=setup?.timelineRange;if(range&&(compareTemporal(month,range.start)<0||compareTemporal(month,range.end)>0))throw new Error('탐색 기간 밖입니다. 선택한 시점이 탐색 기간 밖입니다.');
}
export function initialBoundsView(bounds,_layout={contentWidth:900,contentHeight:624,flatBaseScale:900/(2*Math.PI),globeBaseScale:624*.455},projection='flat'){
 if(!['globe','flat'].includes(projection))throw new TypeError('Initial camera requires a supported projection.');
 if(!bounds)return {projection,view:{globeRotation:[-15,-25,0],globeZoom:1,flatCenter:[0,0],flatZoom:1}};
 const span=(bounds.east-bounds.west+360)%360||360,center=((bounds.west+span/2+540)%360)-180;
 const latitude=(bounds.south+bounds.north)/2,view={globeRotation:[-center,-latitude||0,0],globeZoom:1,flatCenter:[center,latitude],flatZoom:1};
 return {projection,view};
}
