# W2-P6-2 — 공유국경 Feature 속성 축소 실험 결과

2026-11-03 (Asia/Seoul).
**판정: 격리 실험 정확성 및 전송 크기 절감 확인 / 전체 지도 표시 성능 개선 미입증 / 제품 반영 보류.**

## 실험 범위와 근거

- 고정 Pando 소스: `fe8282ba32761ab9586348d1712e11cc1f4e7882`.
- 자료 라이브러리 pin: `5eb7be55208efaafe39bd5a65ec2f111d70b9053`.
- Runtime data revision: `data-f50b7f480c812df6f5ea0c40f5461ab0`.
- 실행 환경: **Ubuntu GitHub Actions Chromium 151 Linux 소프트웨어 WebGL 경로**, 1280×800 viewport, 지도 canvas 1280×752, DPR1, ko-KR/Asia-Seoul, 2026-11→2025-12.
- Windows GTX1650 실GPU 151/D3D11 선행 비교값과 혼합하지 않는다. GPU scheduler 256KiB를 변경하지 않았다.
- 최종 CI: https://github.com/kimjeon-il/Pando/actions/runs/41532665763 (success), 증거 artifact `13183230994` (w2-p6-2-pinned-feature-projection-ab-a, 14일 보존).
- 진단: `tools/w2-p6-2-project-country-feature.mjs`, `tools/w2-p6-2-projection-experiment.mjs`, `tests/unit/w2-p6-2-feature-projection.test.mjs`, `.github/workflows/w2-p6-feature-projection-experiment.yml`.
- 이전 P6-0/1의 254국 full snapshot 13,308,801 JSON UTF-8 bytes를 독립적으로 재검증.
- **제품용 Worker·렌더러 JS, C++/WASM, GIS 및 배포는 이번 실험에서 수정하지 않았다.** 브라우저 페이지 초기 주입으로 Worker.postMessage에만 실험용 projection을 씌웠다. 원본 Feature 객체와 좌표 배열은 보존했다.

## 최소 필드 계약

이 실험은 지도 문서·메인 렌더러의 Feature를 축소하지 않는다. Worker 전송용 wrapper만 생성한다.

| 필드 | A 원본 | B 최소 projection |
| --- | --- | --- |
| Feature type / id | 원본 | 그대로 |
| geometry type / coordinates | 원본 | **동일 객체 참조, 무손실** |
| properties.entityKind / parentId | 원본 | 그대로 |
| boundaryRootId | 원본 존재 시 | 그대로 |
| boundaryGeometryRevision | 원본 존재 시 | 그대로 |
| 기타 properties: name, metadata, notes, style, source 등 12개 | 전송 | 제거 |
| boundaryPristine | 전송(47개) | 제거 (메인의 baseline 판정은 기존대로) |
| 메시지 requestId, projectGeneration, geometryRevision, quality, includeOutlines, cacheUrl, removedIds | 원본 | 그대로 |

Worker는 polygonGeometryDigest를 통해 실제 원본 좌표 SHA를 계산하고, 내부 경계의 parent/root/entityKind를 검증하며, 종전 replace/patch와 패킷 수명/취소 인증을 그대로 실행한다. Feature 문서 자체를 편집하거나 shape 객체를 transfer/detach하지 않았다.

## 254국 입력 byte 절감 (실제 Viewer에서 캡처한 객체, JSON UTF-8 크기)

| 항목 | A 원본 | B 축소 | 변화 |
| --- | ---: | ---: | ---: |
| Worker 전체 입력 JSON UTF-8 | **13,308,801 B** | **12,944,884 B** | **−363,917 B / −2.7344%** |
| properties 합계 | 372,535 B | 9,793 B | −362,742 B / −97.37% |
| geometry/coordinates | 12,910,807 B geometry | 동일 형상 | **좌표 변경 없음** |
| 전송 국가 Feature | 254 | 254 | 변동 없음 |

B의 속성 축소는 JSON 기준 약 2.73%를 절약했다. Chromium 구조화 복제 내부의 실제 전송 바이트나 OS/프로세스 메모리 절감률을 직접 재는 수치는 아니다. 완성된 새 메인 스레드 stringify/structuredClone 작업을 **연도 전환 임계경로에는 추가하지 않았다**. 크기 계량과 SHA 계산은 초기 지도 준비 이후 별도 진단 경로에만 수행했다.

## 실제 브라우저 A→B→A2 예비 비교

각 조건 **새 Chromium 프로세스 2회**, 예열 전환 반복 실험은 아님. 아래 수치는 이벤트의 클릭 시각→2025-12 시점 commit까지의 실험용 경과시간이며 기존 W2-P4/5 Windows 실GPU의 `onPresented` p50과 직접 비교할 수 없다.

| 조건 | 경과시간 원시 표본 (ms) | 기술적 중앙값* | 첫 시점 전환에서 새 Worker full 요청 |
| --- | --- | ---: | ---: |
| A 원본 | 3,798 / 2,313 | 3,055.5ms | 1/2 |
| B 최소 projection | 4,005 / 3,718 | 3,861.5ms | 2/2 |
| A2 원본 복구 | 2,258 / 2,312 | 2,285.0ms | 0/2 |

* n=2의 중앙값은 두 값의 평균일 뿐이므로 통계적 성능 판정이나 실GPU 개선/악화율로 일반화하지 않는다. 조건별 Worker 요청 발생 비율이 다르다. 이 표에서 **전송 최적화로 지도 표시가 개선됐다는 증거는 없다.**

첫 254국 메인 `postMessage` 동기 호출의 각 표본:
- A: 290 / 179ms
- B: 167 / 166ms
- A2: 179 / 179ms

같은 run 내 독립 Worker A-B-A `postMessage` 표본은 다음과 같다.
- run A-0: 182 / 174 / 190ms
- run B-0: 184 / 185 / 206ms
- run A2-0: 237 / 190 / 257ms

부분적인 입력 호출 시간 감소는 있지만, 전송 객체 2.73% 축소의 순수 인과적 효과나 실제 체감 향상을 입증하지 못한다. CPU 부하, 브라우저 시작 상태, 초기 Worker 패킷 완료 타이밍, 메인 렌더러 재사용이 섞여 있다.

## 정확성/출력 동등성

- **기존 source-pinned 공유국경 Worker 단위 테스트 21개 + 신규 projection 단위 테스트 3개 = 24/24 통과.**
- 실제 지도 2026-11→2025-12 완료 A/B/A2 총 **6개 표본의 의미 SHA-256 일치**: `84eeed0ee1b2268b7e841a121416355205dc20c306feb89373e58b18ff086ad5`.
- 동일 조건에서 canvas 1280×752 스크린샷을 decode한 **RGBA 픽셀 SHA-256 6/6 일치**: `a91fbc01f65388299eb9f6d352079d3bf70e4b375a104bd7f2fa903141e8c920`.
- 각 A/B/A2 브라우저 최초 샘플에서 **새 Worker를 각각 3개씩 별도 생성**해 총 **9회 실제 Core/WASM 공유국경 패킷 생성**. 패킷의 metadata 및 모든 TypedArray byte SHA가 9/9 일치: `bc058062a1896f9548f56f6fe97a6130fa2c4a2eb734355d662bb8ef6312aaac`.
- 분리 Worker는 모두 cache miss로 시작하므로 WASM·모듈 초기화와 패킷 준비까지의 11초대 roundtrip을 실사용 IPC 지연이나 cache-hit 효과로 해석하면 안 된다.
- 새 geometry 좌표·소유 관계·entityKind/parentId/outline/quality의 변형이 실사용 경계 표현을 바꾸면 해당 변형 입력을 Worker가 반영하도록 하는 계약은 단위 테스트로 확인하되, 해당 변화가 있는 실제 날짜별 254국 전환은 이번 실험의 범위에 없음.
- Worker protocol 오류 롤백의 Linux CI 2회 성공은 선행 테스트 41461767199의 근거다. P6-2는 제품 오류 처리 코드를 수정하지 않았으며 새 Windows D3D11 오류 주입·rapid cancellation·장기 메모리 검증을 이 실험으로 완료했다고 주장하지 않는다.

## 판정과 다음 단계

**P6-2 원본 형상 보존·속성 최소화 실험은 기능적으로 성공했으나, 사용자 전체 전환 지연 개선은 미입증. 실험용 코드를 제품 `gpu-map-renderer.js`에 이식하지 않는다.**

약 97%가 형상 좌표이므로 전체 Feature metadata 줄이기는 단독 대규모 성능 개선책이 아니다. 다음 우선순위는 P6-3의 Worker 검증 완료 국가 형상 + 정확한 변경분 전송이다. 다만 처음 Worker가 authoritative full snapshot을 받을 때의 비용은 여전히 남는다. 입력 delta를 위해 메인에서 매 시점 전체 형상을 JSON/SHA로 재계산하는 방법은 W2-P5 B1의 메인 스레드 Long Task 문제를 재발시킬 수 있어 제외한다.

P6-3 전 Core temporal candidate changeset이 실제로 안정적으로 ID/geometry/ownership 변경·삭제를 알려주는지, Worker의 baseToken 및 resync fallback이 안전한지 우선 조사한다. 제품 적용 여부는 Windows GTX1650 D3D11에서 각 arm cold n≥10/warm n≥20, 동일한 실GPU 데이터/CPU load, 전체 onPresented p50/p90/최대·입력 반응성·메모리·복구·지도 해시를 비교한 뒤 결정한다.

## 저장·보존

이번 작업의 변경은 `tools/` 진단 소스 2개, `tests/unit/` 시험 1개, `.github/workflows/` 시험 1개, 본 보고서뿐. 이미 완료된 P6-0/1 증거와 W2-P4/P5 고정 자료, Windows worktree 및 미커밋 `docs/branch-policy.md`, WASM/manifest, GIS 지도, main/배포에는 손대지 않았다.
