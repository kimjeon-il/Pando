# Country lineage storage 실행 기록

작업 브랜치: 양쪽 `codex/country-lineage-storage`. Web 기준은
`008b99b5ca2dd39936e51f7ddd11c0c70fc7bb74`, App 기준은
`b5120b5b9cf03780783b642782e93db8dbfa565c`다. main 병합·배포·앱 패키징은 포함하지 않는다.
최종 후보 쌍과 실제 checkout byte SHA-256은
`test-results/country-lineage-storage/manifest-<WEB_CANDIDATE_SHA>.json`에 고정한다.

## 1–3. 파일 변경과 제거

최종 후보와 기준의 `git diff --name-status` 전체 목록은 같은 검증 산출물의
`web-files.json` / `app-files.json`이다. modified/added/deleted를 각각 기록한다.
Web source의 flat state JSON 284개와 generated/v1을 제거하고,
계보 source 262개와 entity-scoped generated/v2를 추가했다.
옛 catalog 이름 필드, 수동 버전 선택, 종류·상태·지역 필터,
historicalLibrary DOM/CSS 이름, sourceLibraryId/source_library_id와
원본→프로젝트 단일 ID lookup을 현재 호출부에서 제거했다.
항상 숨겨져 있던 snapshot 가져오기 UI/action도 제거했다. reference snapshot
데이터와 service 조회는 유지한다. 기본 지도 원본 ID는 재발급하지 않는다.
이전 실행 기록·거부 fixture·이전 packed 비교 산출물은 호환 reader가 아니다.

## 4–6. 최종 정본과 identity

```json
{
  "schemaVersion": 1,
  "lineageId": "germany",
  "names": {"ko": "독일", "en": "Germany"},
  "entities": [{
    "schemaVersion": 2,
    "entityId": "state:DEU",
    "entityKind": "general",
    "names": {"ko": "독일", "en": "Germany"},
    "alternateNames": [],
    "lifetime": {"validFrom": null, "validTo": null},
    "geometryVersions": [{
      "versionId": "state:DEU:natural-earth-5.1.1",
      "validFrom": null,
      "validTo": null,
      "datePrecision": "current",
      "certainty": "high",
      "sourceId": "natural-earth-5.1.1",
      "geometry": {"type": "MultiPolygon", "coordinates": []}
    }],
    "parentEntityId": "",
    "instantiation": {"mode": "independent"},
    "metadata": {},
    "sourceInfo": {}
  }],
  "relations": []
}
```

이는 필드 구조 예시이며 실제 geometry/lifetime 자료를 대체하지 않는다.
실제 source는 `assets/data/territorial-entities/source/countries/<lineageId>.json`이다.
현재·역사 모두 동일 경로/계약이다. 284 entity / 287 version / 262 lineage를 보존했다.
국가 identity 병합·분리 또는 역사 geometry·기간 생성은 하지 않았다.
구유고 geometry는 1992-04-26까지, 신유고는 1992-04-27부터의 기존 입력을 보존했다.
계보 grouping은 명시적 membership이고 주권·identity 연속성을 추론하지 않는다.
기간 공백/중복 및 불량 참조는 기존 temporal owner와 catalog validator가 거부한다.

## 7–9. 빌드·로딩·geometry parity

현재 snapshot → lineage source reader → 현재 FeatureCollection → 기존 canonical encoder
→ preview/PCG/shared-boundary → 기존 renderer다. 국가별 chunk를 startup에서 읽지 않는다.
라이브러리는 기존 loader의 index → 선택 entity gzip → hash/schema 검증 → 기존 cache로
접근한다. 검색은 geometry fetch가 없고, 반복 선택은 같은 chunk를 재사용한다.
현재 258개 feature의 ID·좌표·형상 fingerprint와 encoded PCG/shared-boundary는 보존됐다.
독립 리뷰의 전체 source metadata/instantiation/sourceInfo/version 비교도 차이 0이다.
미리보기의 winding/크기 보정은 표시용 복사본에만 적용하며 source 좌표는 바꾸지 않는다.

## 10–11. 검사·빌드 증거

M0–M6에는 각 단계 집중 검사만 실행했고 M7 구현 완료 후 전체 검사를 시작했다.
전체 단위는 1,729 통과 / 0 실패 / 0 skip이며 마지막 리뷰 보정 뒤에는 영향받은
검사만 다시 실행했다. 일반 Python 247개와 DEM Python 15개는 모두 통과했다.
중간의 Python schema 9 기대와 flat-source recipe fixture 실패는 확정된 새 계약에 맞게
수정했다. sibling entity·추가 version·수동 이름·국기·출처 보장을 유지했다.
처음 DEM 실행의 rasterio 누락은 작업용 Python dependency 경로로 해결했다.

전체 lint, JS syntax(752 파일), runtime boundary(304 모듈/순환 없음),
command(51), provenance(13), versioning JS(25), worker(25), renderer(37),
domain(20), startup contract(12), country schema, catalog generation,
UI architecture/layering/IA/registry/surface 검사가 통과했다. 이는 중복 실행 그룹이며
전체 단위 수에 합산하지 않는다. 마지막 UI 제거 뒤 component audit도 통과했다.
현재 packed build와 metadata/version checker는 exit 0, 앱 선택 target 빌드는
기존 Qt/MinGW/ZLIB 도구체인과 별도 `D:/build/Pandoeditor-country-lineage`를 사용한다.
마지막 세대/미리보기 보정의 controller/import/preview 18개와 capability wiring 7개도
통과했다. App 후보는 `4006e41745c9f03a70eea21de22411f3954cbbf8`다.
선택 native target 빌드 exit 0, GIS export/historical 생성 프로그램 3개와
독립 ZIP/SQLite oracle exit 0, GeoPackage 프로그램 exit 0, Qt StorageTests
11 통과/0 실패/0 skip, timeline probe 31 storage + 9 numeric + 2 flag +
24 interval + 8 content-interval 검사 통과다. Qt 로그 인자 경로를 잘못 지정한
첫 저장 검사 exit 1은 절대경로 인자로 고쳐 같은 검사를 재실행했다.

전체 브라우저는 306개를 시작했으나 사용자의 명시적 축소 선택으로 중단했다.
완료된 4 통과 / 4 실패 / 0 skip, 나머지 298개는 미완료다.
실패는 경계 cut의 vertex 표시/Undo, 색상 trigger 비표시,
WebGL2/WebGL1 country scene의 rebuilding 대기다. 이번 계보 경로 밖이며,
동일 기준 SHA에서 원인을 확정하는 재실행은 하지 않았다. 실패를 성공으로 세지 않는다.
보정 전 집중 browser의 East Prussia modal 미해제와 USSR Undo timeout도 로그를 보존한다.
최종 관련 browser는 7 통과/0 실패/0 skip이다. 실제 WebGL2/Canvas의
North Schleswig, USSR, East Prussia, GDR 정적 가져오기·archive/정체성/출처·
단일 history·Undo/Redo와 index/chunk/flag/preview·헤더를 검증했다.
실제 codec/Worker 교환은 첫 고정 코드 쌍에서도 10 통과/0 실패/0 skip이며,
fixture README의 v9 안내만 v10으로 갱신한 뒤 새 문서 포함 SHA 쌍에서 다시 실행해
manifest에 기록한다. 제품 코드 및 fixture 입력/expected는 이 마지막 갱신에서 바꾸지 않았다.

## 12. 성능 범위

실제 startup의 catalog/index/chunk 요청 0, catalog 검색 index 1회,
반복 선택 chunk 1회와 기존 cache 재사용을 검증했다.
국가별 파일 분리로 전체 앱 실행 속도가 빨라졌다는 결론은 내리지 않는다.
이전 M15 ready/GPU 제출/메모리 측정의 미통과와 Node/Linux preview gzip 재생성 문제는
새 성능 결과로 덮지 않는다. 기존 측정은 `territorial-entity-storage.md`의 과거 기록과
해당 validation 산출물을 참고한다. 새 전체 p95/GC 후 retained heap 비교는 미실행이다.

## 13. 후속 범위와 재검증

실제 국가 정체성 재분류·추가 역사 자료·유고 entity 분리·앱 계보 UI·유한 시간 편집,
범위 밖 브라우저 실패 및 이전 성능 gate는 후속이다.
App delta는 원본 baseline 없을 때 `BASE_DATA_REQUIRED`로 거부한다.
프로젝트/identity 버전은 10/6, timelineRecords는 1이다.
공통 날짜 의미·월말 커서·전체 geometry archive·정적 UI 활성화 정책은 바꾸지 않았다.
실제 JSON/native/GeoPackage 교환은 기존 production Worker와 App codec을 사용한다.

```powershell
$env:PATH = 'C:/Users/taeeu/Qt/6.8.3/mingw_64/bin;C:/Users/taeeu/Qt/Tools/mingw1310_64/bin;' + $env:PATH
$env:QT_QPA_PLATFORM = 'offscreen'
node tools/check-timeline-exchange.mjs D:/build/Pandoeditor-country-lineage/timeline_project_tests.exe test-results/country-lineage-storage/exchange
```

명령은 manifest의 고정 Web/App SHA에서 실행한다. 후보 고정 뒤 코드/fixture가 바뀌면
새 SHA·새 검증 쌍을 기록해야 한다. 원격 CI·main·live 배포 성공을 이 로컬 결과로 주장하지 않는다.
