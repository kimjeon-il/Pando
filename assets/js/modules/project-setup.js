import {parseTemporal,compareTemporal} from './temporal.js';
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
export function boundsFromCorners(a,b){if(!a||!b)throw new Error('지도 안에서 범위를 지정하세요.');return {west:a[0],east:b[0],south:Math.min(a[1],b[1]),north:Math.max(a[1],b[1])};}
export function initialBoundsView(bounds,layout={contentWidth:900,contentHeight:624,flatBaseScale:900/(2*Math.PI)}){if(!bounds)return {projection:'globe',view:{globeRotation:[-15,-25,0],globeZoom:1,flatCenter:[0,20],flatZoom:1}};
 const span=(bounds.east-bounds.west+360)%360||360,center=((bounds.west+span/2+540)%360)-180;
 return {projection:'flat',view:{globeRotation:[-center,-(bounds.south+bounds.north)/2,0],globeZoom:1,flatCenter:[center,(bounds.south+bounds.north)/2],flatZoom:Math.max(1,Math.min(64,Math.min((layout.contentWidth-24)/(layout.flatBaseScale*span*Math.PI/180),(layout.contentHeight-24)/(layout.flatBaseScale*(bounds.north-bounds.south)*Math.PI/180))))}};}
