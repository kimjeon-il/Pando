# 내장 지명 메커니즘 검증 기록

기준: `main`의 `c134b2971d3e007d823f865a2bac1b6a9ddaca70`, 검증일 2026-10-01.
작업 브랜치: `codex/place-runtime-million`.

요청한 1–7단계를 구현했다. 8단계 Natural Earth/GeoNames 데이터와 실제 데이터
빌드 파이프라인은 제외했다. 배포용 `assets/data/places/manifest.json`은 비어 있다.
synthetic 데이터는 테스트가 임시 폴더에 만들고 종료 후 지운다.

## 소유권과 요청 흐름

- `place-contract.js`와 `place-codec.js`: 명시적인 `builtin:place:<source>:<sourceId>`
  식별자, Unicode 이름/출처/좌표/분류/순위 계약, 검증하는 버전 1 바이너리 코덱.
- `place-worker-store.js`: 기존 수계 tile window를 재사용한다. 단계는 해당 zoom의
  전체 후보를 담는 누적 LOD이며, query tile 상한을 넘으면 더 거친 단계로 내려간다.
  canonical projection frame으로 화면과 label box를 먼저 판정한 후 후보 상한을 적용한다.
- `place-runtime.js`: 기존 Worker RPC와 latest-wins scheduler를 사용하고, 준비된
  불변 snapshot을 한 번에 교체한다. 이후 기존 label layout을 invalidate한다.
- `app-country-labels.js`: 사용자 지명과 snapshot을 같은 label collision/layout에
  합류시킨다. 전체 내장 데이터는 `projectState.labels`, DOM, 기존 공간 인덱스에 넣지 않는다.
- 지도 interaction은 viewport/search 작업을 취소하고 새 조회와 label layout을 막는다.
  기존 표시의 좌표만 재투영하며 settle 후 최신 viewport를 처리한다.
  실제 요청은 render 함수 밖의 invalidation/interaction 경계에서 시작한다.
- 선택은 기존 selection domain이 소유한다. 내장 속성은 읽기 전용이며 drag/delete/batch
  변경을 막는다. `복사하여 편집`은 기존 history/autosave를 사용해 사용자 지명을 만든다.
  `sourcePlaceId`를 저장·GIS 교환에 보존하고, 복사본이 있으면 원본의 중복 표시를 억제한다.
  Undo로 복사본이 사라지면 원본 표시가 복원된다.
- 검색은 기존 객체 검색 controller에 합류한다. 두 글자 이상의 정규화된 이름 prefix를
  Worker에서 찾으며, 이전 검색·닫힌 검색·이동 중 결과는 폐기한다.
  일부 결과만 표시할 때는 prefix를 더 입력하도록 안내한다.

## 절대 상한

| 대상 | 상한 |
| --- | ---: |
| 내장 viewport 후보 | 1,500개 |
| 전체 label layout 후보 (선택·고정 포함, High 포함) | 2,048개 |
| tile 레코드 / 조회 tile | 512개 / 96개 |
| shard / manifest 응답 | 512KiB / 8MiB |
| raw shard + decoded tile LRU | 24MiB |
| query 임시 레코드 | 최대 1,500 + 4 × 512개 |
| 내장 검색 결과 / 검색 DOM 행 | 50개 / 150개 |
| 선택·검색으로 보존하는 레코드 | 256개 |

LRU 예산은 바이너리 byte 수와 decoded 레코드의 모든 문자열 UTF-16 길이 및
레코드 overhead를 보수적으로 합산한다. 브라우저/Worker 전체 process heap의 상한을
뜻하지 않는다. 선택 보존도 무한히 늘리지 않으며, 대량 선택에서는 primary를 우선한다.
Worker 후보 순위는 priority/population/id이고, 최종 collision 순위는 기존 kind 정책을
유지한다. 실제 데이터별 세부 순위 조정은 이번 범위에 포함하지 않는다.

## 검증 결과

- 관련 단위 테스트 87개 통과: 계약/손상 바이너리, 최신 요청/취소, dense 후보 cap,
  날짜 변경선/극지 회전/화면 밖 후보, LRU와 Unicode 예산, 검색 취소·재시도·닫기,
  기존 label visibility/편집/serialization, 공유 RPC의 취소 및 실패 시 sibling abort.
- 브라우저 2개 통과: 기존 사용자 지명 메타데이터 편집, 내장 검색→읽기 전용 선택→
  복사→수정→Undo. 실제 module Worker를 사용하고 fixture 데이터만 route로 제공한다.
- 변경 파일 ESLint, Worker architecture, renderer-v2 architecture, `git diff --check` 통과.
- 독립 리뷰에서 critical/important 잔여 지적 없음.

100만 synthetic 레코드를 8,738개 tile로 생성하고 실제 Worker/HTTP 206/RPC를 통해
평면·구체·zoom·중심·회전을 바꾸는 viewport 24개와 마지막 레코드 검색을 검증했다.
메인 layout도 실제 canonical 투영 좌표로 실행했다.

| 측정 | 결과 | 테스트 기준 |
| --- | ---: | ---: |
| fixture 생성 | 4,599ms | — |
| Worker viewport 조회 p95 | 71.71ms | 1,500ms 미만 |
| 메인 label layout p95 | 1.126ms | 50ms 미만 |

Node 24.19 / 이 작업 환경에서의 수치다. 실제 데이터 품질이나 모바일 gesture FPS를
측정한 값은 아니다. 성능 테스트는 독립 실행한다:

```sh
node --test tests/unit/place-million.test.mjs
node --test tests/unit/place-codec.test.mjs tests/unit/place-layout.test.mjs tests/unit/place-runtime.test.mjs tests/unit/place-worker-store.test.mjs tests/unit/place-label-workflow.test.mjs
npx playwright test tests/browser/place-runtime.spec.mjs tests/browser/label-metadata-edit.spec.mjs
```

`check-runtime-boundaries.mjs`의 `renderDistributions` public facade 오류는 기준 commit의
별도 복사본에서도 동일하게 재현됐다. 이번 변경과 무관한 기존 실패로 남겨 두었다.
전체 테스트 suite를 실행하거나 관련 없는 구조를 변경하지 않았다.
