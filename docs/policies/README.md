# 판도연구소 정책·규칙 중앙 색인 — P0

> **단계:** P0 문서 실태 조사 및 정본 후보 색인 (2026-11-11)  
> **조사 기준:** `kimjeon-il/Pando` `main = work/ui @ 762a730a6654361911a9c700afcc29396f4fa2cf` (조사 시작 시점)  
> **구조화된 전수 목록:** [inventory.p0.json](inventory.p0.json)

## 이 문서의 효력과 범위

이 문서는 **새 정책을 제정하거나 기존 정책의 우선순위를 바꾸지 않는다**. 기존 `AGENTS.md`, 브랜치 규정, 분야별 규정 및 실행 코드의 의미는 그대로 유지한다. 여러 문서에 흩어진 규칙의 **발견 경로·소유자 후보·중복·구형 참조·검토 상태**를 기록하는 색인이다.

`inventory.p0.json`은 Pando의 `docs/**/*.md` **198개 전부**, 루트 Markdown 3개, `config/`·`contracts/`·`scripts/contracts/`의 JSON 15개, GitHub Actions 워크플로 73개, 선별한 구현 코드 소유자 22개, 합계 **311개 경로**를 포함한다. 별도 데이터 저장소 `PandoLab-library-data`에서는 직접 확인한 지명 편집 정책 2개와 보고서 색인만 참조한다. **2,440개 전체 제품 코드 파일의 의미 분석을 완료했다는 뜻은 아니다.**

### 분류 원칙

- **현행 식별(11)**: 원문에서 현재 상위 규정 또는 정본임을 명시한 문서. 실제 제품 동작과 완전 일치함을 별도로 인증한 것은 아니다.
- **정책·기록 혼재(5)**: 정책을 설명하면서 과거 단계별 실행·테스트·커밋 기록도 포함한 문서.
- **재조정 필요(9)**: 사라진 경로·이전 제품 구분 또는 겹치는 소유권 등 구체적인 정합성 검토 대상.
- **추가 검토(47)**: 구조/제목을 확인했으나 현재 유효 범위와 정본 여부를 확정하지 않은 문서.
- **역사·설계·검증 참고(127)**: 과거 계획·구현·실행 기록. **삭제 또는 무효화가 확정되었다는 의미는 아니다.**
- **연구·격리 단계(2)**: 문서가 생산 적용 대상이 아님을 명시한 연구·이행 절차.
- **기계 실행 정의(88)**: JSON 설정·계약 및 CI YAML. 실제 소비 경로에 대한 실행 검증은 하지 않았다.
- **코드 소유자 후보(22)**: 정책에 대응하는 주요 소스 경로. 전체 호출 그래프와의 정합성은 후속 확인 대상이다.

분류 기준은 `inventory.p0.json`의 `basis`로 구별한다. `content-checked`는 대표 원문을 읽어 분류한 경우이며, `document-location`/ `file-format-and-location`은 경로·형식 기반 **1차 분류**다. 과거 문서를 `historical-reference`로 분류해도 임의로 폐기하거나 다른 현행 정책으로 덮어쓰지 않는다.

## 분야별 기존 정본 및 후보 위치

| 분야 | 우선 찾아볼 현재 규칙·계약 | 분리하여 볼 관련 자료 및 상태 |
| --- | --- | --- |
| 저장소·상설 브랜치·작업 범위 | [AGENTS](../../AGENTS.md), [브랜치 운영 정책](../branch-policy.md) | [외부 라이브러리 작업 규칙](../library-data.md); GitHub 워크플로·검사 구성은 별도 실행 정의 |
| 앱 버전·자료 버전 | [버전 정책](../../VERSIONING.md) | [스키마·교환 설계](../architecture/versioning-migrations-exchange.md): 버전 규칙 중첩 검토 |
| GIS 역사 국경·해안선 조사 | [역사 국경 복원 공통 정책](../historical-border-reconstruction-policy.md) → [벡터 원본 조사 절차](../historical-vector-source-workflow.md) | [역사 해안선 시범 연구](../historical-coastline-change-workflow.md)는 **런타임 미적용** |
| 국토·프로젝트 자료 소유권 | [프로젝트 정본 계약](../architecture/project-data-ownership.md), [라이브러리 정책](../library-data.md) | [프로젝트 콘텐츠 0~2단계 전환 기록](../architecture/map-project-data-ownership.md); 실제 선택 핀은 [config/library-data.json](../../config/library-data.json) |
| 객체·시간축·저장 | [객체 계약](../architecture/territorial-entity-contract.md), [시간축 규범 계약](../timeline-contract.md), [영토 출처 계약](../territorial-source-contract.md) | 옛 Web/App 분리 문구 재검토; 현재 C++/WASM 모델과 스키마를 맞춰야 함 |
| 도시 후보·도시 표시 | [후보 선별 코드](../../tools/lib/geonames-policy.mjs), [인구·공간 5단계 표시 계산](../../tools/build/place-display-rank.mjs), [지명 적용·검증 기록](../place-runtime.md) | 선별/승인/5단계 표시/역사명/도시 존속기간은 **서로 다른 정책**; [지명 교환 문서](../place-sync-contract.md)는 구형 코드 경로 재검토 필요 |
| 지도 라벨·렌더링·LOD | [공통 표시 규칙 및 실행 기록](../architecture/map-visual-policy.md), [적응형 품질](../architecture/adaptive-render-quality.md) | [동적 LOD 실행 기록](../architecture/map-rendering-lod-p0-p1.md), [프로젝트 공통 LOD 계획](../architecture/project-common-lod-implementation.md), 실제 `src/rendering/` 코드 |
| UI 공통 규격 | [UI 규격 정본](../architecture/ui-architecture.md) → [컴포넌트별 예외](../architecture/ui-components.md) | [정보구조 설계](../architecture/ui-information-architecture.md): 현재 읽기 전용 Viewer 적용 범위 검토 |
| 데이터 URL·폐기 | [GIS 데이터 URL 정책](../data-url-retention-policy.md) | [과거 URL 정책 변경 기록](../validation/data-versioning-phase11-policy.md)과 중복 |
| 검증·CI | [검사 선택 계약](../../scripts/contracts/application-checks.json) 및 `.github/workflows/` | `docs/validation/`, `docs/development/testing/`은 검사 증거와 현재 규범을 구분 |
| 외부 GIS·지명 연구 | [Pando 데이터·보고서 정책](../library-data.md), [외부 보고서 색인](https://github.com/kimjeon-il/PandoLab-library-data/blob/main/reports/README.md) | 정책 JSON·조사 원문은 외부 저장소에 보존. 제품 코드 정본과 별개의 판본·자료 핀 적용 |

**지명 정책의 중요한 구분:** `tools/lib/geonames-policy.mjs`는 *후보로 선정할 장소*를 정의한다. `tools/build/place-display-rank.mjs`는 *승인된 도시의 인구·주변 밀집도·고립도에 따른 표시 단계*를 계산한다. 1~5등급의 기본 인구 기준은 각각 **100만·50만·20만·10만·5만 명**이다. 정확한 과거 가중치 산식은 발견되지 않았으며 현재 공간 보정 계수는 재구성한 값이다. 외부 자료의 `reports/places/historical-display-policy.json`, `korean-map-label-policy.json`은 조회 당시 **staged** 상태다. 이들을 현행 렌더러가 모두 적용한다고 간주하지 않는다.

**GIS 작업 선별과 렌더링 정밀도는 다른 규범:** 역사 국경 정책의 Natural Earth 1:10M 및 약 500km² 선별 기준은 *조사·복원 대상과 상세도 결정*에 관한 원칙이다. 프로젝트별 1~32배 카메라·벡터 LOD는 *현재 보유한 원본의 표시 파생 처리* 문제다. 둘을 숫자만으로 하나의 축척 정책이라고 취급하지 않는다.

## 중복·정합성 검토 대장 (P1 후보, 미수정)

| ID | 확인한 위치 | 근거와 후속 확인 |
| --- | --- | --- |
| P0-01 | [AGENTS.md](../../AGENTS.md) | 자원 무효화 정책의 `assets/js/modules/resource-update-policy.js` 참조는 현재 트리에 없음. 현재 `src/runtime/resource-dependency-policy.js`와 `src/rendering/resource-update-policy.js`의 관계를 따라 링크 갱신 필요 |
| P0-02 | [place-sync-contract](../place-sync-contract.md) | `apps/editor`·`assets/js/modules/place-contract.js`를 소유자로 기술. 실제 `src/document/place-contract.js`, 현재 PLAC v3/지명 규칙과 대조 |
| P0-03 | [timeline-contract](../timeline-contract.md), [territorial-source-contract](../territorial-source-contract.md) | 폐기된 독립 Web·App 개발 전제가 규범 문구에 남음. 날짜 의미 계약 자체는 임의 수정·삭제 금지 |
| P0-04 | [VERSIONING](../../VERSIONING.md), [versioning-migrations-exchange](../architecture/versioning-migrations-exchange.md) | 앱 버전 증분 규칙 중첩. VERSIONING의 규범과 후자 스키마 설명을 분리·참조화할 수 있는지 검토 |
| P0-05 | [data-url-retention-policy](../data-url-retention-policy.md), [data-versioning-phase11-policy](../validation/data-versioning-phase11-policy.md) | 2026-10-09 결정이 반복됨. 후자의 당시 검증·조치 내역을 유지하면서 정책 중복 제거 후보 |
| P0-06 | [map-visual-policy](../architecture/map-visual-policy.md), [place-runtime](../place-runtime.md) | 운영 규칙/표시 정책과 단계별 테스트·완료 기록이 동일 파일에 축적. 근거를 보존하며 규범과 기록을 분리할지 검토 |
| P0-07 | [historical-border-reconstruction-policy](../historical-border-reconstruction-policy.md), [LOD P0·P1](../architecture/map-rendering-lod-p0-p1.md) | 1:10M 조사 일반화와 동적 LOD의 담당 범위를 명시적으로 분리. 현재 단계에서 직접 충돌로 판정하지 않음 |
| P0-08 | [place-runtime](../place-runtime.md), [place-display-rank](../../tools/build/place-display-rank.mjs) | 인구 기본 5등급·공간 보정의 계산 정본, 빌드 매니페스트와 Worker 소비의 관계 확인. 역사 순위를 현대 인구로 확정하지 않음 |
| P0-09 | [platform-sharing-inventory](../architecture/platform-sharing-inventory.md), [app-ui-boundaries](../architecture/app-ui-boundaries.md) | 구형 Windows/Android/Editor 계보 및 `app.js` 경로가 혼재. 이전 제품 사양을 현행 필수 규칙으로 오인하지 않도록 구분 |
| P0-10 | [project-data-ownership](../architecture/project-data-ownership.md), [map-project-data-ownership](../architecture/map-project-data-ownership.md) | 현재 프로젝트 정본 계약과 0~2단계 전환 실적의 계층·효력 정리 |
| P0-11 | [ui-information-architecture](../architecture/ui-information-architecture.md) | '추가·편집 Surface' 규격의 현 Viewer 기능·제품 지원 범위를 재확인 |
| P0-12 | [project-common-lod-implementation](../architecture/project-common-lod-implementation.md), [adaptive-render-quality](../architecture/adaptive-render-quality.md) | 초기 개발 계획의 'main 미통합' 설명, 이후 공유 LOD·렌더 자원 관리 코드와 현재 효력 정합성 재검토 |

### 적용 판단 순서 (분류용, 신규 정책이 아님)

1. 해당 업무에 **현재 명시된 상위 규정**이 있는지 확인한다. 파일이 최근에 수정되었다는 사실만으로 상위 규정이 되지는 않는다.
2. 프로그램의 **현재 실행 소유자·스키마·자료 핀**과 설명 문서를 별도로 구분한다. 코드가 동작한다고 해서 역사적 사실이나 사용자 승인된 정책으로 간주하지 않는다.
3. `staged`·`prototype`·`archived`·날짜가 박힌 작업 기록을 그대로 현재 생산 규칙으로 승격하지 않는다.
4. 둘 이상의 정책이 실제로 충돌하면 한쪽을 임의 폐기하거나 숫자를 합치지 않고, 충돌 범위·근거·대체 승인 여부를 기록하여 별도 정리한다.

## 후속 단계와 변경 경계

**P0 완료 기준:** 현존 문서 전수 경로 색인, 관련 기계 규칙 및 주요 코드 소유자 위치 확인, 상태의 근거 수준 표기, 분야별 문서 찾아보기, 검토 대장 작성. 이 색인에서 `needs-review`로 남긴 파일의 내용 검토는 다음 단계의 대상이다.

**P1 후보:** (1) 구형 경로 수정, (2) 중복 규범을 상위 정본에 모으고 실행·검증 기록은 참조화, (3) 이행/계획 문서에 현재 효력을 명시, (4) 기존 링크·CI 검사·외부 핀 대조. **P0에서 이 작업을 수행하지 않는다.**

**이번 조사에서 변경하지 않은 것:** 기존 `AGENTS.md`, `docs/` 원본 정책·설계, `src/`·`scripts/`·`config/`·`contracts/`, 외부 라이브러리, 워크플로, `main`, 배포 자산. 기존 문서나 계획·증거의 삭제 및 이동도 하지 않는다.

**검증 한계:** GitHub의 원격 트리와 선별 문서·원본 소스를 읽어 확인했다. 로컬 상설 워크트리의 미커밋 상태, 전체 import/Worker/CI 호출 그래프 및 실행·브라우저 테스트는 이 조사 범위에서 확인하지 않았다. 따라서 파일 존재 및 현재 명시된 계약의 위치를 확인한 것이지, 모든 규칙이 현재 런타임에 정상 적용된다는 인증은 아니다.
