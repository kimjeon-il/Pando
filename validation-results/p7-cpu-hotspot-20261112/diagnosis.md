# P7 32배 지도 CPU 렌더링 병목 원인 분석 (2026-11-12)

## 정본·근거
- 제품 소스 기준: `main@87763ec1c231484c2d3787f49056f3f9f918a97d`.
- GIS 라이브러리 핀: `921d86aa3c03ffa0b3d5879ad30c9914c4d1b31a`.
- 기본 실측: 별도 Chromium 3회, `work/renderer-profile-20261112/validation-results/renderer-profile-20261112/renderer-[1-3].json` 및 `renderer-aggregate.json`. Actions #43110237635, 검증 보존 #43111964083.
- 추가 진단: 이 폴더의 `hotspot.json`, `hotspot-sync.json`. Actions #43114589702, #43115663214.
- 동일 브라우저 종류: Ubuntu 24.04 / Chromium 151.0.7922.34 / ANGLE SwiftShader Vulkan / WebGL2 / 1280×800 / 고정 날짜 2026-11-06. 진단용 CPU 프로파일러 오버헤드가 있으므로 기존 3회 실측과 시간을 직접 A/B 비교하지 않는다.
- 원본 Viewer/지명/GIS 소스 수정 없음. 모든 추가 계측은 작업 브랜치의 측정 스크립트에서 수행.

## 최종 판정
32배 지구본의 직접적인 메인 스레드 블로킹은 반복적인 **동기 WebGL 상태 조회**에서 발생했다. 특히 수계 coverage와 국경선 coverage가 프레임별로 GL 상태를 읽는 `capture()/captureState()` 경로가 긴 대기의 호출 위치였다. LOD 업로드 중에는 `gl.isBuffer()`도 추가로 긴 대기를 발생시킬 수 있다.

아래 상태 조회가 왜 느려지는지에는 누적 GPU 제출 작업량/SwiftShader 드라이버 동기화가 개입할 수 있다. **상태 조회 코드가 동기 대기를 발생시키는 호출 지점**이라는 사실과 **앞선 GPU 작업의 근본 비용**은 구분해야 한다. 무조건 쿼리 한 줄을 없앤다고 GPU 렌더링 자체의 비용까지 없어지는 것은 아니다.

## 1차 P7 독립 3회 실측
| 구간 | 전체 장면 재그리기 | 한 전체 장면의 stroke draw calls | rAF p95 간격 | 렌더러 누적 CPU 제출 p95 |
| --- | ---: | ---: | ---: | ---: |
| 유럽 32배 | 13–15회 | 678회 | 3,792ms | 3,345ms |
| 동아시아 32배 | 10회 | 678회 | 3,763ms | 3,554ms |

국가 메시 재생성은 해당 구간에 추가되지 않았고, HTML 레이아웃 사용 시간은 거의 0이다. 지구본 프레임은 평면용 affine scene reproject cache를 사용할 수 없으며, DEM/Hydro 정착 과정에서 GPU 전체 장면을 반복 생성했다.

## 2차 CPU 샘플링 및 WebGL API 시간
| 범위 | 메인 ScriptDuration | getParameter 동기 호출 시간 | WebGL instanced-draw 호출 자체 | 비고 |
| --- | ---: | ---: | ---: | --- |
| 1차 집중 진단 유럽 32배 | 33,059ms | 23,328ms | 약 4ms | 13,321회 instanced draw 요청 |
| 1차 집중 진단 동아시아 32배 | 49,571ms | 19,073ms | 약 1ms | JS CPU sampler의 `isBuffer()` 27,172ms |
| 2차 호출 위치 진단 유럽 32배 | 23,058ms | 21,504ms | 약 4ms | 총 422회 getParameter |
| 2차 호출 위치 진단 동아시아 32배 | 31,078ms | 29,303ms | 약 4ms | 총 406회 getParameter |

위 시간은 각 진단 세션의 총합이다. CDP CPU 샘플과 WebGL 메서드 진입/복귀 시간은 서로 다른 계측이다. 따라서 GPU 실행 시간과 동일시하거나 두 값을 단순 합산하지 않는다.

2차 진단의 100ms 이상 동기 조회 호출 그룹:
| 구간 | GL enum 및 함수 | 코드 호출 위치 | 장시간 호출 수 | 해당 호출 총대기 |
| --- | --- | --- | ---: | ---: |
| 유럽 | `BLEND_EQUATION_RGB` (32777) | `gpu-stroke-renderer.js:356`, `captureState()` | 10 | 11,776ms |
| 유럽 | `COLOR_CLEAR_VALUE` (3106) | `gpu-hydro-coverage.js:100`, `capture()` | 4 | 8,153ms |
| 유럽 | 기타 블렌딩 상태 조회 | `gpu-stroke-renderer.js:356-357` | 2 | 1,484ms |
| 동아시아 | `COLOR_CLEAR_VALUE` (3106) | `gpu-hydro-coverage.js:100`, `capture()` | 8 | 29,208ms |

동아시아에서 `COLOR_CLEAR_VALUE`를 읽는 단일 호출은 최대 4,430ms였다. 동일 장면 한 프레임의 `getParameter()`는 49회 호출됐고, 단일 호출에 4초 이상 걸리는 경우가 있었다.

대조: 유럽 거의 동일 화면에서 instanced draw 803회를 생략한 첫 비교는 정상 4,170ms, 생략 4,280ms였다. 해당 한 프레임에서 둘 다 `getParameter()`에 4초 이상 대기했다. 이미 제출된 드라이버 작업이 남았을 가능성을 배제하지 못하므로, **이 한 번의 생략 실험만으로 국경선 그리기의 전체 GPU 비용을 0이라고 판단할 수 없다**.

## 코드상 병목 연결
1. `src/rendering/gpu-hydro-coverage.js:88-107`: `capture()`가 텍스처, 프레임버퍼, viewport, 프로그램, clearColor, 혼합 상태 등을 일괄 `gl.getParameter()`로 조회한다. `render()` → `drawHydro()` → `drawGpuBaseScene()`의 실제 프레임 경로.
2. `src/rendering/gpu-stroke-renderer.js:338-360`: `captureState()`가 같은 GL 상태를 반복 동기 조회한다. `drawCoverageStyle()` → `drawBatches()` → `drawCountryBoundaryStrokes()`의 경로.
3. `src/rendering/gpu-stroke-renderer.js:251-294`: 업로드 `drainUploads()`는 이전 버퍼의 바인딩을 `getParameter(ARRAY_BUFFER_BINDING)`으로 읽고 `finally`에서 `gl.isBuffer(savedBuffer)`로 검사한다. 추가 진단 1회에서 `isBuffer`에 CPU 샘플 약 27.2초가 기록됐으며 LOD·GPU 자원 업로드 상황과 관련이 있다.
4. `src/rendering/gpu-map-renderer.js:4335`: 일반 렌더 패스도 `getParameter(FRAMEBUFFER_BINDING)`을 호출한다.
5. `src/rendering/workers/canvas-scene-composition-core.js`의 `countryBoundaryBatches()` 및 `src/rendering/gpu-stroke-renderer.js`의 `drawSegments()/drawRoundNodes()`는 가시성 축소 없이 소유자별 그리기 범위를 순회한다. 678회 stroke call/완전한 장면이 기본 비용으로 남는다.
6. `src/rendering/gpu-map-renderer.js`는 지구본의 카메라 변경에 평면 affine scene cache를 적용하지 못한다. DEM/Hydro의 여러 자원 준비 완료 신호가 8–21회 full redraw를 유발했다.

## 권장 수정 순서 (이번 분석에서는 미수정)
1. **P0**: `gpu-hydro-coverage.capture()/restore()`와 `gpu-stroke-renderer.captureState()/restoreState()`의 반복 `getParameter()`를 줄인다. 단일 WebGL RenderDevice에 패스별 명시적 상태 소유·기록을 두고 필요한 상태만 보존한다. GL 상태 무결성·블렌드·Stencils·Coverage AA, WebGL1/2, Context Loss와 Canvas fallback 검증 필수.
2. **P0**: `gpu-stroke-renderer.drainUploads()`의 `gl.isBuffer()`가 동기 장애가 되지 않도록 세대/버퍼 수명 원장 기반 복원으로 바꿀 수 있는지 검토. 이미 삭제된 버퍼나 context-recovery 자원을 잘못 재바인딩하면 안 된다.
3. **P1**: 32배에서 DEM/Hydro 준비 완료에 따른 전체 장면 재그리기 연쇄를 줄이고 현재 뷰 기반 dirty 범위·갱신 병합을 적용. 승인된 지도 프레임과 다른 세대의 이미지를 섞지 않는 규칙 유지.
4. **P1**: 공유 국경의 `ownerRanges`를 보수적인 뷰포트 culling 후 인접 구간 병합/동일 스타일 배치로 축소. 국경 일치·선택·역사 날짜·가림 정확도를 변경하지 않는다.
5. **검증**: 동일 Chromium/SwiftShader로 전·후 3회, `getParameter/isBuffer` 지연과 프레임 p95/p99, full redraw, 메모리 및 LOD 전환 비교. 이후 실제 하드웨어 GPU에서도 별도 검증해야 한다.

## 한계
이 진단이 검증한 것은 **WebGL 상태 조회 위치에서 장시간 JS 실행 정체가 관측됐다는 사실**이다. WebGL `getParameter`가 반환을 지연시키는 근본 원인이 드라이버 대기인지, 앞서 제출한 어떤 셰이더·타일·복합 연산인지의 GPU 내부 분해는 아직 완료되지 않았다. 앱 구조만으로 동기 조회 제거 시 전체 프레임의 동일한 만큼 절감된다고 보장하지 않는다. 따라서 제품 수정과 A/B 실측은 별도 단계다.
