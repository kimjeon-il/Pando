# P5-1 — 연도 전환 잔여 병목 및 C++ 읽기 전용 후보 계약

- 날짜: 2026-10-31 (KST)
- 계측 대상 `work/ui`: `938054bc4581015110d4367a5da1ee922fbe8a83`
- 자료 pin: `kimjeon-il/PandoLab-library-data@139941d8056418547c796068304ba8db3696fe69`
- CI: https://github.com/kimjeon-il/Pando/actions/runs/41204726143
- 단계 판정: **P5-1 계측·계약 확정.** 새 C++ API 구현, 앱 경로 전환, 최종 성능 달성은 포함하지 않는다.

## 1. 실제 CI 재측정

최초 화면이 승인된 다음 DOM 연도 조작에서 기존 temporal `onPresented`까지 측정했다. 기존 화면 공개·Core 규칙을 교체하지 않았으며, Playwright 응답 라우팅에만 임시 계측 코드를 삽입했다. 페이지 출력(scanout) 완료·실제 모바일 기기 측정이 아니다. 현재 달력은 `2026-10`, 다른 연도는 12월로 조회하는 기존 의미를 유지한다.

| 전환 | 종류 | 지도 공개 ms | 후속 ready ms | 조회·조립 ms | JSON 인코딩 ms | SHA-256 ms | Core baseline 승인 ms | Core loadBaseline ms | replaceSnapshot ms | 소스 캐시 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2026-10 → 2025-12 | 첫 인접 | 2946 | 5643 | 88 | 384 | 17 | 472 | 1671 | 269 | miss |
| 2025-12 → 2026-10 | 현재 복귀 | 2445 | 5063 | — | — | — | 465 | 1677 | 261 | hit |
| 2026-10 → 2016-12 | 첫 먼 이동 | 12281 | 14974 | 89 | 391 | 16 | 461 | 1695 | 9579 | miss |
| 2016-12 → 2026-10 | 먼 이동 복귀 | 11721 | 14386 | — | — | — | 468 | 1675 | 9534 | hit |

소스 캐시 hit는 **해당 브라우저 세션 내의 불변 소스 바이트 캐시** hit이고, Core의 기준 자료 등록을 건너뛴 의미가 아니다. 위 단계들은 비동기 큐·대기·중첩을 포함한 경과 시간이며 순수 C++ CPU 프로파일이나 합산 가능한 독립 구간이 아니다.

4회 모두 결과 확인 성공, 페이지 오류 0, 같은 시점 재방문의 전체 의미론적 자료 해시 일치, 카메라 보존 및 dirty/Undo/Redo 불변 검사 통과. 초기 테스트 전용 앵커 4개 검사도 성공했다. 네 번의 측정으로 p95 신뢰도나 모바일 성능·누수 부재를 주장하지 않는다.

마지막 기록의 Worker 수는 모든 전환에서 7개. CDP JS heap used는 순서대로 약 137.2 / 280.0 / 120.7 / 120.9 MiB로 변동했다. 힙 외의 WASM·GPU 할당량은 포함하지 않으므로 리소스 누수 판정에 사용하지 않는다.

**병목 판정:** 인접 이동은 Core 적재 1.67–1.68초와 기준 자료 승인 0.46–0.47초의 반복 비용이 크다. 2016년 왕복은 `replaceSnapshot` 9.53–9.58초가 주된 비용이다. 따라서 P5-2~P5-5에서 Core 적재를 줄이더라도 먼 연도 이동의 9초대 화면 준비는 별도 계측·최적화 없이는 남을 수 있다. 성능 목표로 정확성 검증·물리 지형 일치 검사를 생략하지 않는다.

## 2. 현행 소유권·위험

1. `BuiltinSession.prepareProjectSource`는 월별 나라 목록·시점 스냅샷을 조립하고 JSON 직렬화 후 SHA-256을 계산한다. JS 캐시는 현재 3개 항목·24MiB 상한이며, **Core 핸들이 아닌 불변 sourceBytes만** 보존한다.
2. `DocumentSession::storageBaselineLoad(WebStorageAssetSource)`는 소스 해시·크기·codec을 검증하고 새로운 `storageBaseline_` 슬롯과 `storageBaselineId_`를 설정하면서 **epoch를 증가**시킨다. 이 슬롯은 현재 하나다. 이 경로를 예측 로딩에 그대로 호출하면 활성 Core 상태가 변한다.
3. `DocumentSession::documentLoadBaseline`은 보관된 typed source 문서를 복사해 `Project` 후보를 만들고 원본 C++ 검증·시점 조회 후 활성 `project_`에 채택한다. 확인된 핸들이 아니면 거부한다.
4. `ProjectDomain.replaceAccepted`는 기존 Core replacement capsule을 획득하고 generation을 전진시키며 Core 적재 → 선택·표시 catalog 재승인 → 화면 교체 후 성공을 공개한다. 실패 시 capsule로 문서·선택·draft·이력·저장 checkpoint를 복원한다. 캡슐을 대체하거나 두 번째 영속 이력 소유자를 만드는 것은 허용하지 않는다.
5. `core.document-prepare`의 기존 `candidateId`는 **편집 명령의 단일 미리보기 슬롯**이다. 새로운 날짜 조회 후보의 등록·폐기에 이 슬롯을 재사용하면 편집 대기 상태와 충돌할 수 있으므로 금지한다.
6. `core-document-client`는 단일 순서 보장 큐를 사용한다. 동기 C++ 커밋이 Worker에 전달된 뒤 취소해도 acknowledgement는 소비해야 한다. C++·WASM ABI와 pinned JS/WASM 쌍 검증을 유지한다.

관련 소스: `shared/core/src/document-session.cpp`, `shared/core/src/webstorage.cpp`, `shared/core/include/pandoeditor/document-session.h`, `shared/frontend/js/modules/builtin-session.js`, `shared/frontend/js/modules/project-domain.js`, `shared/frontend/js/modules/core-document-client.js`.

## 3. P5 단계의 후보 준비 계약 (구현 전 확정)

**핵심 불변식:** 후보 준비는 활성 C++ `project_`, `storageBaseline_`, `activeBaseline_`, `selection_`, `draft_`, 현재 월, history/dirty/checkpoint, source/epoch, 저장·UI·GPU에 **아무 변경도 일으키지 않는다**. 검증과 조회의 단일 정본은 계속 C++ Core다. 새 JS 역사 판정기를 두지 않는다.

### 자료 입력과 식별자

- 준비 입력에는 명시적인 `sourceMonth`(정규화된 월), `baseDataset`, `dataRevision`, 고정된 manifest SHA-256, 실제 저장 바이트 SHA-256, `encoding`, 원본/해제 크기가 필요하다. 기존 Core의 SHA-256·codec·크기 제한·프로젝트 schema 검증을 그대로 통과해야 한다.
- 새 불변 원본의 identity는 `[baseDataset, dataRevision, manifestSha256, sourceMonth, sourceBytesSha256, codec/ABI]`의 정확한 결합이다. 연도만으로 동일성을 판단하지 않으며 국가의 유효기간은 원본의 연월일 정밀도를 유지한다.
- 연도 이동의 목표 month와 snapshot의 sourceMonth는 기존 내장 지도 계약에 맞게 일치해야 한다. 현재 연도는 현재 월, 다른 연도는 12월인 현행 규칙을 바꾸지 않는다.
- 형상 보관은 검증된 C++ GeometryStore의 불변 객체를 공유할 수 있지만, 내용·geometry ref/version·소유권이 다른 경우 절대로 버퍼·기하를 재사용하지 않는다. 임의의 정수 핸들은 복원·Worker 재시작·세대 변경 후 유효하다고 가정하지 않는다.

### 읽기 전용 API 의미 계약 (아직 구현된 API 명칭이 아님)

| 개념적 동작 | 입력 | 허용 효과 | 거부/실패 동작 |
| --- | --- | --- | --- |
| **Source prepare** | 검증할 bytes·dataset·manifest·월·ABI | 분리된 불변 typed source 및 소유된 opaque token을 보관. 같은 pin은 재사용 가능 | 원본·해시·크기·schema 오류면 토큰 발행 금지; 활성 상태 변경 금지 |
| **Candidate prepare** | source token·정확한 월·대상 프로젝트 generation·예상 Core epoch·요청 ticket | 기존 C++ 검증·resolver로 분리된 목표 `Project`/world 후보 생성. 원본 참조와 준비 비용 관찰 | epoch·pin·월·세대·ticket 불일치면 폐기. 활성 문서·history·선택 변경 금지 |
| **Candidate adopt** | 후보 token·최신 ticket·expected epoch/generation | **기존 `replaceAccepted`의 단일 승인·복구 경계 아래서만** 활성 프로젝트 전환. 선택/catalog·Core read-model·렌더 장면은 같은 generation으로 처리 | 무효 token·중복 채택·오래된 epoch 거부. 채택 실패면 기존 capsule로 복원 |
| **Candidate discard** | 미채택 후보 token | 원본 참조·후보 메모리 해제(재호출 안전). Core mutation 없음 | 미존재/이미 해제된 token은 안전한 no-op 또는 명시적 재사용 오류로 계약 고정; 화면 영향 없음 |

토큰은 Core Worker 세션 소유이며 외부 JS에는 불투명하다. Core 문서에 대한 포인터, 임시 JSON 문서, 편집 후보 `candidateId`를 UI에 전달하지 않는다. 단일 실행의 speculative 준비는 최대 1개만 활성으로 유지하고, 사용자 요청이 오면 최신 요청을 먼저 처리한다. 기존 24MiB JS cache 정책과 별개로 Core source/candidate 할당량을 계측해 상한을 두며, 초기에는 무제한 native cache를 허용하지 않는다.

### 채택 순서·취소·복구

1. 사용자 요청을 받을 때 최신 ticket을 갱신한다. 현재 완성된 지도·연도·라벨·클릭 판정은 유지하고 예측 후보는 무효화한다.
2. 준비 후보는 C++에 분리돼 존재한다. Worker 응답이 늦게 도착해도 source pin, 예상 Core epoch, 프로젝트 generation, 최신 ticket을 **채택 직전 다시 검증**한다. 실패하면 폐기하고 상태를 건드리지 않는다.
3. 채택 전에 기존 `ProjectDomain`의 command/open queue와 replacement capsule을 보존한다. Core 채택은 중단 불가능한 구간이므로 RPC acknowledge를 처리한 다음 성공 화면을 공개하거나 오류를 복원한다. 최종 승인 전에는 낡은 검색·클릭을 재실행하지 않는다.
4. 새 시점의 Core read model, 선택, 검색, 공유 국경, 물리 지형, GPU 장면은 같은 generation으로 확인한 후 기존 `onPresented`에서 연도 표시를 확정한다. **Core 승인만으로 화면 전환 성공을 선언하지 않는다**.
5. 준비·채택·GPU 업로드·화면 공개·사용자 파일 열기 중 어느 단계든 실패하면 마지막 성공 문서 및 화면을 복원한다. 오류를 무시하거나 날짜만 바꾸거나 잘못된 완성 프레임을 공개하지 않는다.
6. 자료 pin 변경, 파일 전환, 새 Worker/ABI, 유효기간·버전 변경, 프로젝트 generation 이동, epoch 변경 시 구 후보를 무효화한다. GPU context가 바뀌면 기존 GPU 리소스를 폐기하지만 C++ 검증 완료 사실만으로 GPU 버퍼를 유효하다고 간주하지 않는다.

## 4. 다음 P5-2~P5-7 게이트와 우선순위

- **P5-2**: Core 불변 source 재사용 구현. 단순 `storageBaselineLoad` 선행 호출 금지. 현행 source 검증·단일 정본·active epoch/checkpoint 불변성을 fixture로 먼저 증명한다. 데이터 pin·월별 distinctness·복구 중 재사용 금지 검증.
- **P5-3**: C++ 읽기 전용 날짜 후보 생성. 동일 국명·국기·국체·존속기간·상하위 관계·기하 참조·정확한 날짜/월 조회를 현행 전체 계산과 대조.
- **P5-4**: 후보 채택·폐기를 기존 Core capsule에 연결. 중복 채택, 실패 주입, 빠른 A→B→A, 사용자 파일 열기, 선택·저장·Undo/Redo 불변성 계약을 확인.
- **P5-5**: WASM/Worker 연결. pinned ABI, 명시적 버퍼 소유권, 취소 후 늦은 acknowledge, 세대 변화, 메모리 해제 확인.
- **P5-6**: 실제 Viewer 시점 전환 적용. 기존 전체 경로와 같은 world/snapshot/선택·공유 경계·물리 지형으로 화면 공개. 먼 연도 `replaceSnapshot` 병목의 원인별 계측을 별도 유지.
- **P5-7**: 네이티브 C++과 WASM 같은 소스의 날짜·형상·관계·이력·실패 처리 동등성 확인.

**필수 중단 기준:** 새 경로가 기존과 의미론적으로 다르거나, 오래된 후보를 공개하거나, source pin·기간·좌표를 누락하거나, Core epoch/dirty/Undo/Redo를 준비 과정에서 바꾸는 경우 병합 차단. 전체 지도 계산 범위가 안전하게 좁혀졌다는 근거가 없으면 그 작업만 기존 전체 갱신으로 대체한다.

**현재 남은 우선순위:** P5-2에서 약 0.46초 승인 및 약 1.68초 Core 적재의 중복을 줄일 후보 기반을 만들되, 먼 이동의 약 9.5초 `replaceSnapshot` 비용은 P5-6에서 별도 병목으로 취급한다. 4개 표본을 속도 목표 달성 증거로 사용하지 않는다.

## 5. 검증 및 작업 경계

- 이번 P5-1 변경은 읽기 전용 테스트/계측과 이 계약 문서에 한정된다. 런타임 Core·WASM·GPU/화면 코드는 수정하지 않는다.
- 실행: `node --test tests/unit/map-transition-p5-1.test.mjs`; `pnpm exec playwright test --config tests/browser/map-transition-p5-1.config.mjs`. 이 CI 실행의 개별 표본·계측된 단계와 오류는 Actions artifact `map-p5-1-938054bc4581015110d4367a5da1ee922fbe8a83`에 있다.
- 계측 브라우저는 CI Chromium 데스크톱 1280×800 한 환경이고, 앱 WebGL1·2 전체 플랫폼 검증이나 실제 Android 검증이 아니다.
- P0에서 사용자 지시로 유예한 기존 장시간 타임아웃 2건은 '기존 보류' 상태이며 성공으로 바꾸지 않는다. **새 정확성 실패는 유예 대상이 아니다.**
- `main` 병합·실제 사이트 배포·C++ API 수정은 아직 지시되지 않았다. 다음 실행 단위는 P5-2 하나이다.
