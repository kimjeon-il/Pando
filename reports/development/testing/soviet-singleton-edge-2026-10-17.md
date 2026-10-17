# OBJ-092 — 단일 접촉 공유 국경선 edge 레코드 압축

> 날짜: 2026-10-17 · 상태: `verified-focused-paired-and-12cycle`
> 제품 기준: `main 48fe06df9ec7ce47b4f0640d1f43817deb3a964a` (OBJ-090 + OBJ-091 계측 통합)
> 코드 변경: `assets/js/modules/country-shared-boundary-packet.js` (공유 경계 Worker의 `edges` 관리), 국가/역사 지형 원본·C++/WASM 변경 없음
> 근거: [OBJ-091 실측](soviet-retained-owner-graph-2026-10-17.md) · [단위/접촉 CI #39032938617](https://github.com/kimjeon-il/Pando/actions/runs/39032938617) · [같은 러너 메모리 A/B #39032861530](https://github.com/kimjeon-il/Pando/actions/runs/39032861530)

## 원인과 자료구조 변경

OBJ-091에서 현대 세계의 **68,616개 shared edge**가 실제로 모두 **접촉 기여자 1개씩**임을 확인했다.
기존 `edges`에서는 각각 `{contributions: new Map(),value}`를 생성하고,
339개 국가 간 접촉을 하나의 기여 `Map` 원소로 저장했다. 같은 segment 객체는
`contacts`와 `edges.value`에서 공유했고, 별도 복제된 value는 0개였다.

기존 Map은 여러 기여가 같은 좌표로 겹칠 경우에만 필요하다.
따라서 최초 단일 기여 경계는 `{contact, value}`라는 작은 레코드만 보유한다.
실제로 다른 국가 쌍의 기여가 추가되면 그때 `contributions: Map`으로 승격하며,
다중 기여 중 하나가 삭제되어 다시 하나만 남으면 직접 segment 참조로 축소한다.
마지막 기여가 삭제되면 `edges` 항목 전체를 제거한다.

제품의 `contacts`, `contactsByOwner`, prepared source/packed 인덱스, C++ 접촉 후보
계산, `segments()`와 GPU stroke 패킷은 그대로 유지한다.

## 동일 GitHub 러너 A/B 실측

Ubuntu 24.04 Chromium WebGL2/SwiftShader, 1440×900, 소련 1989-06 → 현대 2026-10,
동일 Worker idle/GC 절차를 연속 실행. `main 48fe06df` vs 후보 소스 `49418149`.

| 지표 | 변경 전 | 변경 후 | 차이 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker V8 used heap | 133.40MiB | **127.38MiB** | **−6.02MiB / −4.51%** |
| 전체 Worker JS used heap | 187.94MiB | 181.91MiB | −6.03MiB |
| 해당 Worker WASM 선형 | 57.63MiB | 57.63MiB | 0 |
| 전체 Worker WASM 선형 | 403.5MiB | 403.5MiB | 0 |
| Chromium 전체 PSS | 1776.40MiB | 1775.65MiB | −0.75MiB |
| 소련 진입 | 5745ms | 5806ms | +61ms |
| 현대 복귀 | 5136ms | 5245ms | +109ms |

국가 254개, source segment **544,163개**, shared edge **68,616개**, contacts **339건**,
packed 국가 인덱스 **194개**, packed source segment **540,989개** 및
`preparationCount=513` 전후 동일.
Worker JS 감소는 같은 환경 GC 후 비교한 결과이며 PSS 0.75MiB 차이와
100ms대 시간 차이는 변동 범위 안에서 보아야 한다.
이 수치를 CPU 최적화나 전체 프로세스 RAM 6MiB 절감의 입증으로 해석할 수 없다.

## 회귀 계약과 남은 조사

[CI #39032938617](https://github.com/kimjeon-il/Pando/actions/runs/39032938617):
신규 promotion/demotion·cache restore·irrelevant patch 검사 **3/3**,
기존 contacts/C++/편집 검사 **53/53** 통과.
여러 국가가 동일 edge에 기여하면 Map을 생성하고, 제거 시 남은 실제 출처 참조
및 변경 없는 경계의 객체 identity를 보존하는지 확인했다.

[12회 소련↔현대 장기 회귀 #39032977889](https://github.com/kimjeon-il/Pando/actions/runs/39032977889)
**전체 성공**: 현대 복귀 12/12회 유휴 판정도 12/12회 통과,
페이지 오류 0, 전체 자동저장 증가 0, 프로젝트 미리보기 Worker 0개.

| Worker 현대 복귀 GC 지표 | 초반 4회 중앙값 | 후반 4회 중앙값 | 변화 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker JS | 128.19MiB | 128.23MiB | +0.04MiB |
| 전체 Worker JS | 182.84MiB | 182.91MiB | +0.07MiB |
| 전체 Worker WASM 선형 | 403.5MiB | 403.5MiB | 0 |
| GPU Stroke 앱 추적 버퍼 | 29.03MiB | 41.32MiB | +12.29MiB (이후 수렴) |

12회 완료 후 추가 30초 유휴에서는 공유 국경선 Worker JS **127.54MiB**,
Chromium 전체 PSS **1,851.64MiB**로 측정됐다. 12회 복귀 후 즉시 PSS 중앙값은
1,968.71→1,998.09MiB 상승했지만 마지막 30초 유휴에 감소했으며,
이를 Worker JS 누수나 GPU VRAM 증분으로 배정할 근거는 없다.

별도 카메라 pan에서 Stroke `buildCount=9→9`,
Stroke GPU 업로드 `16,030,056→16,030,056`바이트,
폴리곤 GPU 빌드 `33→33`, 국경 requestId `3→3`을 확인했다.
추가 선분 생성/업로드 0 계약이 유지됐다.

일반 브라우저 CI가 파괴적 OBJ-091 진단 파일을 자동 선택한 사례는
`PANDO_RETENTION_DIAGNOSTIC_ISOLATED=1`에서만 실행하고,
그 외의 정상 제품 회귀에서는 `test.skip`하도록 수정했다.
이것은 **제품 결함이 아니라 CI 범위 설정 문제**였다.
[P2 소스 일치 생성물 #39033212558](https://github.com/kimjeon-il/Pando/actions/runs/39033212558) 성공:
10개 지리·세계·메시·공유 국경선·장소·네이티브 출력 계열 지문이 원래 main과 모두 같았고,
빌드 메타데이터만 새 JS 소스 버전으로 갱신됐다. C++/WASM 바이너리 해시는 변하지 않았다.
Android 실기기는 제외한다.

**다음 우선 영역:** OBJ-091의 약 **79~87MiB** 국가별
`preparedById`·상위 공간 인덱스·원본 선분/typed-buffer 보유 그래프.
이것은 실제 편집 경계 후보 탐색에 필요할 수 있으므로 강제 해제나 매 프레임 재계산으로
치환하지 말고, 원본 refs·인덱스 구조와 C++ 접촉 엔진의 소유 계약을 함께 검증해야 한다.
