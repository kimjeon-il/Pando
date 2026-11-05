// Bounded, read-only browser inspection. No native or repository write APIs.
const brief=(v,max=180)=>String(v??'').slice(0,max);
const number=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function collectViewerInspection({rendererStats={},documentSnapshot={},month='',meta={},
  readOnly=true,territorialCount=null,evidenceLoaded=false,performanceReport=null,diagnosticEvents=[],
  capturedAt=new Date().toISOString()}={}){
  const gpu=rendererStats||{},doc=documentSnapshot||{};
  const report=performanceReport&&typeof performanceReport==='object'?performanceReport:null;
  const events=Array.isArray(diagnosticEvents)?diagnosticEvents:[];
  return Object.freeze({schema:'pando-viewer-inspection-v1',capturedAt:brief(capturedAt,48),
    map:{renderer:brief(gpu.renderer||'미확인'),
      presentation:brief(gpu.mapReadiness?.status||'미확인'),
      canonicalMeshReady:gpu.canonicalMeshReady===true,
      terrainReady:gpu.terrainReady===true,
      surfaceQuality:brief(gpu.surfacePresentation?.quality||'미확인'),
      countryCount:number(gpu.countryVisibleCount)??number(gpu.countries),
      publishedGeneration:number(gpu.countriesPublishedGeneration),
      projectGeneration:number(gpu.projectGeneration),
      displayedRevision:number(gpu.displayedRevision),
      requestedRevision:number(gpu.requestedRevision),
      pendingCountryCount:number(gpu.pendingCountryCount),
      frameAcknowledged:Number.isSafeInteger(gpu.displayedRevision)&&gpu.displayedRevision>0
        &&gpu.displayedRevision===gpu.requestedRevision
        &&gpu.displayedGeometryRevision===gpu.committedGeometryRevision,
      projectRenderBlocked:gpu.projectRenderBlocked===true},
    data:{month:brief(month||'미확인',40),
      sourceRevision:brief(meta.dataRevision||meta.assetRevision||'빌드 정보 없음',80),
      projectId:brief(doc.documentId||'미확인',120),
      documentEntities:number(territorialCount),
      readOnly:readOnly===true,
      reviewEvidence:evidenceLoaded?'선택된 검수 증거 있음':'변경 검수 증거 미제공',
      topologyValidation:'미실행 · 원격 검사 결과 별도 확인'},
    performance:{available:!!report,
      domInteractiveMs:report?.browser?.navigation?.domInteractiveMs??null,
      contentfulPaintMs:report?.browser?.paint?.['first-contentful-paint']??null,
      longTaskCount:number(report?.longTasks?.count),
      longTaskTotalMs:report?.longTasks?.totalMs??null,
      layoutShiftScore:report?.layoutShifts?.score??null,
      memorySamples:Array.isArray(report?.memory)?report.memory.length:0},
    errors:events.slice(-20).reverse().map(e=>({
      category:brief(e?.category||'internal',64),
      errorCode:brief(e?.errorCode||'기록',80),
      message:brief(e?.technicalMessage||e?.result||'내용 없음',300)}))
  });
}
