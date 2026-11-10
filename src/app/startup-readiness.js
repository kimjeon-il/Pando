// Read-only presentation of renderer-owned resources. This does not grant editing rights.
export function mapPresentationReadiness({ boundaryReady, boundaryFailed = false, terrainVisible,
  terrain = {}, targetKey, presentedKey, mapPresented = true, band = 'high' }) {
  // An accepted country bitmap/frame and optional DEM readiness are different
  // certificates. Keep the existing combined status for the loading UI.
  const mapReady = !!boundaryReady && mapPresented && !!targetKey && targetKey === presentedKey;
  const terrainReady = !terrainVisible || terrain.terrainReady === true;
  const state = { mapReady, terrainReady };
  if (boundaryFailed) return { ...state, status: 'error', label: '정밀 경계 준비 실패', retry: true };
  if (!boundaryReady) return { ...state, status: 'boundaries', label: '정밀 경계 준비 중', retry: false };
  if (terrainVisible && terrain.terrainFailed) return { ...state, status: 'error', label: '현재 화면 지형 준비 실패', retry: true };
  if (!terrainReady) return { ...state, status: 'terrain', label: '정밀 경계 사용 가능 · 현재 화면 지형 준비 중', retry: false };
  if (!mapReady) return { ...state, status: 'presenting', label: '현재 화면 표시 중', retry: false };
  if (terrainVisible && terrain.terrainResolutionLimited) return { ...state, status: 'limited', label: '제공 자료의 최고 해상도로 표시 중', retry: false };
  return { ...state, status: 'ready', label: `현재 화면 준비 완료 · ${band === 'low' ? '저배율' : '상세'} 표시`, retry: false };
}
