# W2-P6-0/P6-1 — 고정 측정 기준 및 254개 국가 전송 데이터 전수 조사

작성: 2026-11-03 (Asia/Seoul). **상태: P6-0 고정 기준 검증, P6-1 실제 Worker 입력 전수 조사 완료. 신규 Windows GTX1650 성능 측정 및 제품 최적화는 미실시.**

## 1. 소스·데이터·기존 측정 기준

| 항목 | 고정 값 |
| --- | --- |
| Pando 원본 | fe8282ba32761ab9586348d1712e11cc1f4e7882 |
| 외부 라이브러리 pin | 5eb7be55208efaafe39bd5a65ec2f111d70b9053 |
| 런타임 데이터 버전 | data-f50b7f480c812df6f5ea0c40f5461ab0 |
| 완전 빌드 입력 SHA-256 | 5c1287b09961ecbfdcd34d42c0403207caa7c6bab9c954b3fcd89f1d7d6d6eda |
| Windows 기준 GPU·드라이버 | GTX1650 / NVIDIA 32.0.16.1088, Chromium 151.0.7922.34, ANGLE D3D11 |
| 뷰포트·시점 | 1280x800 / 1280x752 canvas / DPR1, 2026-11 → 2025-12 |
| GPU stroke upload | 256KiB job.step, 기존 실험의 1MiB 방식 제외 |

Windows 실GPU 참고값은 W2-P5-2의 원본 A 집단: 첫 전환 별도 Chromium n10, 지도 표시 p50 **2172.9ms**, p90 2245.0ms, 최대 2248.2ms, 2.5초 초과 0/10. 예열 n20 p50 797.2ms. A2 재시험 첫 p50 2201.0ms. 원시 PandoLab-library-data@a2a22c338c5924a83413e449647f4a9b172100e4 (reports/development/performance/w2-p5-2-windows-gpu-2026-11-02/report.md 및 comparison.json). W2-P4-2 원시 분석: PandoLab-library-data@3e63d665f70972902a68008e0d14ec26a2506bad.

P6-1 진단은 위 소스와 data pin을 GitHub Actions에서 별도 checkout으로 사용해 **Linux Chromium에서 실제 Viewer의 국경 Worker에 전송된 입력 객체**를 수집했다. Worker.prototype.postMessage에서 참조만 보관하고, 첫 지도 ready 후 별도 루틴으로 JSON byte를 계산했다. 따라서 실험 중 메인 스레드에 13MB의 추가 직렬화/해시를 삽입하지 않았다. 여기의 KB/MB는 1000 기반 JSON UTF-8 길이이며 Chromium의 native structured-clone wire bytes, 실제 Windows CPU 또는 GPU 시간은 아니다.

검증된 실행: https://github.com/kimjeon-il/Pando/actions/runs/41472398276 (PASSED). 254개 per-country 상세 JSON은 artifact 13156061098: w2-p6-1-pinned-254-country-census (14일 보존, tools/w2-p6-1-country-payload-census.mjs로 재현 가능). 고정 소스 Worker 단위 회귀를 추가한 재실행은 별도 검증을 따른다.

## 2. 실제 전달된 요청의 메타데이터

국가 254개의 실제 전송: type replace / requestId 3 / projectGeneration 1 / geometryRevision 1 / quality canonical / includeOutlines false / skipCacheReconcile false / removedIds 0.

초기에는 generation 0 / requestId 1의 국가 없는 요청도 별도로 발생했다. **이 CI 1회에서 2026-11→2025-12 연도 이동 때는 추가 Worker 입력 요청이 없었고 메인 renderer의 기존 리소스 재사용을 확인했다.** 모든 연도 변경에서 13.3MB가 반드시 전송된다고 주장하지 않는다. 기존 Windows A 조건 n10에서는 실제 Worker 응답을 사용한 전환 6회, 요청·응답이 없는 재사용 전환 4회였다.

## 3. 전체 크기 전수 계량

| 구분 | JSON UTF-8 bytes | Feature 배열 대비 |
| --- | ---: | ---: |
| Worker 입력 전체 메시지 | 13,308,801 | 별도 분모 |
| 국가 254개 전체 Feature 배열 | 13,308,609 | 100% |
| 개별 국가 Feature 크기 합(배열 구분자 제외) | 13,308,354 | 99.998% |
| geometry 값 크기 합 | **12,910,807** | **97.01%** |
| geometry.coordinates 크기 합 | **12,901,670** | **96.94%** |
| properties 값 크기 합 | **372,535** | **2.80%** |
| Feature 전체에서 geometry만 뺀 상한 | 397,802 | 2.99% |

feature properties의 metadata 단일 키 객체 크기 합 301,996 bytes (전체 약 2.27%); 이는 개별 JSON 객체로 측정한 합산값이므로 metadata 필드 제거 때 정확히 이 양이 줄어든다는 뜻은 아님. sourceGeometryVersion 약 14.5KB, coverageMode 약 6.9KB, name/entityKind 각각 약 6.1KB가 그다음 큰 필드다.

- 국가 유형: Polygon 103개, MultiPolygon 151개; null geometry 0.
- 전체 폴리곤 4,277개, 링 4,297개, 내부 홀 20개.
- 정점 561,640개, 경도·위도 숫자 원소 1,123,280개.
- Feature 공통 필드: geometry/id/properties/type/boundaryGeometryRevision 각 254개.
- boundaryRootId 및 boundaryPristine는 각각 47개에만 별도 필드로 존재하며 실제 parentId 값이 비어있지 않은 국가도 47개다.
- 공통 properties 14개: entityKind, locked, metadata, name, notes, schemaVersion, sourceEntityId, sourceFolderId, sourceGeometryVersion, style, parentId, coverageMode, validFrom, validTo.

### 국가별 Feature 직렬화 상위 20개

| 국가 ID | Feature KB | Geometry KB | 정점 |
| --- | ---: | ---: | ---: |
| CAN | 1575.0 | 1573.7 | 68,193 |
| USA | 846.0 | 844.8 | 35,981 |
| RUS | 834.8 | 829.9 | 37,005 |
| ATA | 562.2 | 561.0 | 23,815 |
| GRL | 460.9 | 459.1 | 20,133 |
| IDN | 448.8 | 440.9 | 19,564 |
| CHL | 410.9 | 409.6 | 17,197 |
| CHN | 395.2 | 393.6 | 16,054 |
| NOR | 342.1 | 340.8 | 15,817 |
| AUS | 326.3 | 325.0 | 13,650 |
| PRK | 292.0 | 287.7 | 8,119 |
| BRA | 257.6 | 256.3 | 11,126 |
| KOR | 245.0 | 242.4 | 7,466 |
| MEX | 175.7 | 174.4 | 7,419 |
| IND | 169.3 | 168.1 | 7,737 |
| PHL | 168.0 | 166.7 | 7,406 |
| JPN | 160.2 | 158.9 | 6,952 |
| GBR | 156.1 | 154.9 | 7,113 |
| GRC | 134.4 | 133.1 | 6,096 |
| ARG | 112.5 | 111.2 | 4,674 |

상위 10국이 모든 국가별 Feature JSON 합계의 약 46.60%, 상위 20국이 약 60.66%다. 254개 전체 상세 행은 앞서 언급한 CI 원본 JSON에 보존한다.

## 4. Worker 필드 의존성 매트릭스

| 전송 데이터 | 소스에서 검증한 소비 경로 | P6-2 처리 판단 |
| --- | --- | --- |
| geometry.type + geometry.coordinates | Worker의 polygonGeometryDigest SHA-256, preparedStore의 원본 경계·접촉 계산·outline | 좌표/정밀도/순서/링 전부 반드시 유지 |
| feature.id | preparedStore 및 owner key, root/child, outline 범위 | 필수 |
| boundaryRootId | 공유국경 root/child와 internalOwners 분류 | 필수(47개에 존재) |
| properties.parentId | Worker의 root fallback 및 territorialRootId | 필수 |
| properties.entityKind | 내부 영토 경계 및 root 관계의 topology | 최소 필드 목록에서 보수적으로 유지, 자동 삭제 금지 |
| quality, includeOutlines | 패킷 세분화·outline·Worker 캐시 키 | 필수 |
| requestId/projectGeneration/geometryRevision | 메인의 stale 응답 거부 및 temporalFrameReady | 필수 |
| boundaryGeometryRevision | 메인은 WeakMap 인스턴스 기반 키를 생성, Worker는 실제 SHA로 다시 작성 | 불필요할 가능성 있으나 삭제 전 독립 패킷 검사 |
| boundaryPristine | 메인의 baselineCache 허용 판단, 전송 시 일부 Feature에 포함 | Worker 내 소비여부 확인 후 후보 |
| properties.metadata/notes/name/style/source* 등 | 표시·Core에는 필요, 공유국경 계산에서 직접 사용되는지 추가 확인 | 메인 원본을 변경하지 않고 전송용 projection만 검토 |

이 표는 **필드 삭제를 구현·검증했다는 의미가 아니다**. 부모/상하관계·지명 관련 표시 정보가 다른 경계 계산기에 연동될 수 있으므로 독립적인 출력 해시·픽셀 검사 이전에 생략하지 않는다. geometryRevisionKey는 JS 객체 고유 identity이므로 서로 다른 연도에서 형상이 같다는 증거로 사용할 수 없다.

## 5. 결론 및 다음 단계

**P6-0 소스·자료·기존 Windows 기준 고정 완료, P6-1 실제 254국 payload census 완료.** 약 97%가 실제 geometry인 만큼 단순 properties 제거(P6-2)의 최대 상한은 2.99% 미만이며, 그만큼 실제 first presented가 빨라진다는 보장은 없다.

권고: P6-2는 가벼운 보조 실험으로 유지하되, **P6-3의 신뢰 가능한 baseToken/Worker의 이미 검증된 형상 + 변경분 전송**을 다음 주력으로 설계한다. 단 기존 Core temporal changeset의 정확성, parent/root/geometry SHA identity 및 빠른 취소/오류 rollback/Worker restart 때 전체 원본 전송 fallback을 먼저 증명해야 한다. 최초 startup의 authoritative full 전송 비용은 Worker delta 방식만으로 제거되지 않으며, 전체 성능 개선은 실제 Windows A-B-A를 실시하기 전 확정할 수 없다.

제품 code/Core/WASM·GIS 데이터, main 및 공개 배포는 변경하지 않았다. 이 문서는 연구 기록과 진단 도구·CI 결과만 설명한다. 사용자 Windows 고정 worktree, 미커밋 파일 및 이전 성능 원시 증거를 보존한다.
