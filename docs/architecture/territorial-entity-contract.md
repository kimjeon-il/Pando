# TerritorialEntity 공통 계약 — 일반객체·지방객체

확정일: 2026-10-03. 현행 코드 확인 기준: `main` / `cd85e14`.

이 문서는 **목표 계약**이다. 국가와 하위단위를 동일한 일반객체로 통합하고,
독립적인 지리·역사·문화 권역을 지방객체로 유지한다. 사용자 표시명은 모두
‘객체’다. 실행 코드가 이미 이 계약으로 전환되었다는 뜻은 아니다.

이번 1단계는 이 문서와 [순차 구현 계획](../superpowers/plans/2026-10-03-unified-objects.md)의
정합성만 확정한다. 실행 코드·저장 자료·모델 버전·프로젝트 스키마는 변경하지
않으며 테스트 실행·커밋·푸시·배포를 포함하지 않는다.

현재 저장은 이미 단일 `territorialEntities` 컬렉션이다. 남은 작업은 기존
`country/subunit/region` 구분과 처리 경로의 전환이다. 별도 컬렉션들을 나중에
다시 합치는 단계를 만들지 않는다.

## 1. 객체 구조와 필드

`TerritorialEntity`라는 공통 모델명, GeoJSON Feature 구조와 기존 Store·Repository를
유지한다. 새 클래스·wrapper나 동일 객체를 나타내는 종류별 병행 모델을 만들지 않는다. 기존 지형지물
`GenericFeature`는 이 계약의 일반객체와 별개이며 통합 대상이 아니다.

```text
TerritorialEntity
  type: "Feature"
  id: string
  geometry: Polygon | MultiPolygon
  properties:
    schemaVersion: number
    entityKind: "general" | "regional"
    name: string
    notes: string
    parentId: string
    coverageMode: "partition" | "explicit"
    style: object
    locked: boolean
    validFrom: string | null
    validTo: string | null
    metadata: object
    sourceFolderId: string
    sourceLibraryId: string
    sourceGeometryVersion: string
```

| 필드 | 값·기본값 | 의미 |
| --- | --- | --- |
| `type` | `"Feature"` | 공통 GeoJSON 표현 |
| `id` | 비어 있지 않은 문자열, 기본값 없음 | 두 종류 전체에서 유일한 논리 ID |
| `geometry` | Polygon/MultiPolygon, 기본값 없음 | 직접 소유하는 유효한 canonical 형상 |
| `properties.schemaVersion` | 실제 형식 전환 시 정하는 공통 모델 버전 | 이번 문서 단계에서 변경하지 않음 |
| `properties.entityKind` | `general` 또는 `regional`, 모델 입력에서 필수 | 일반객체 또는 지방객체. 계층 깊이·ID·교차 국가 수에서 추측하지 않음 |
| `properties.name`, `notes` | 문자열, `""` | 명시적 이름과 메모 |
| `properties.parentId` | 문자열, `""` | 일반객체의 상위 일반객체 ID. 지방객체에서는 반드시 빈 문자열 |
| `properties.coverageMode` | `partition` 또는 `explicit` | 최상위 일반객체와 지방객체는 explicit; 자식 일반객체 생성 기본은 partition |
| `properties.style` | 객체, `{}` | 명시적 스타일. 상속·테마 합성 결과는 파생 값 |
| `properties.locked` | Boolean, `false` | 편집 잠금 |
| `properties.validFrom`, `validTo` | 기존 날짜 문자열 또는 `null`, 기본 `null` | 기존 기간 계약 유지 |
| `properties.metadata` | 객체, `{}` | 국기·수도·원본 부가정보의 기존 의미 유지 |
| `properties.sourceFolderId`, `sourceLibraryId`, `sourceGeometryVersion` | 문자열, `""` | 출처 필드 유지. 행정 부모·논리 ID·프로젝트 리비전과 구분 |

`unitType`, `associatedCountryId`, `sovereignId`는 최종 canonical 필드에 없다.
‘국가형/하위단위형’, 독립 권역 Boolean 또는 metadata 안의 동일한 역할 필드로
대체 저장하지 않는다. 국기 metadata의 명시적 `null`과 키 없음 등 기존 값의
의미는 유지한다.

가시성·선택·계산된 면적·계층 깊이·루트·소속 국가·계층 인덱스·렌더링 패킷은
엔티티에 중복 저장하지 않는다. 기존 presentation·selection·Repository·renderer가
자신의 상태 또는 파생 자료로 소유한다.

## 2. 종류와 관계 규칙

### 일반객체 (`general`)

- 기존 국가와 모든 깊이의 하위단위가 같은 모델이다. 계층 위치에 따라 종류를 바꾸지 않는다.
- `parentId`는 빈 문자열 또는 존재하는 다른 일반객체 ID다. 부모 없는 객체는 최상위 객체다.
- 루트라는 이유만으로 정치적 주권 국가라고 판정하지 않는다. 정치적 종속·통제·영유권 주장을 행정 부모 관계로 표현하지 않는다.
- 부모 변경은 같은 ID의 관계 변경이다. 최상위로 올리거나 다른 일반객체 밑에 놓아도 `entityKind`는 general이다.
- 부모 변경에 필요한 형상·coverageMode 검증은 명령이 담당한다. 최상위로 옮길 때는 explicit 조건도 충족해야 한다.

### 지방객체 (`regional`)

- 실레시아 같은 독립 권역이며 `parentId = ""`, `coverageMode = "explicit"`이다.
- 지방끼리의 상하 관계와 특정 국가에 대한 수동 연결은 제공하지 않는다. 일반객체도 지방객체를 행정 부모로 지정할 수 없다.
- 여러 일반객체 또는 다른 지방객체와 겹칠 수 있다. 하나의 일반객체 안에만 있어도 유효하다.
- 걸치는 국가 수나 현재 국경으로 종류를 바꾸지 않는다. 일반객체의 편입·분할·소속 변경으로 지방 형상을 재단하거나 옮기지 않는다.
- 지방끼리 또는 일반객체와의 중첩을 영토 소유권 충돌로 검사하지 않는다. 지방 자체의 형상 유효성과 잠금 검증은 유지한다.
- 겹치는 국가 목록·면적 계산은 필수 저장 필드가 아니며 이번 통합에서 신규 기능으로 추가하지 않는다.

### 공통 무결성·정체성

중복 ID, 누락 참조, 자기 참조, 순환, 일반객체의 지방 부모 지정과 지방객체의
비어 있지 않은 부모를 거부한다. 삭제 후 고아 관계가 남으면 게시하지 않는다.
필요한 관계 정리는 같은 transaction에 포함한다.

부모 변경·편입 후 살아남은 객체의 ID는 유지한다. 새 객체는 새 ID를 받고,
Undo는 삭제된 객체의 원래 ID·형상·관계를 복원한다. 원본 자료 ID·GIS FID·표시용
ID와 논리 ID의 대응은 로딩·가져오기 경계에서 명시한다.

## 3. 생성·사용자 표시

사용자 문구는 ‘객체 추가’, ‘객체 편집’, ‘객체 삭제’로 통일한다. 국가와
하위단위의 생성·편집을 별도 모델로 제공하지 않는다.

| 생성 입력 | 생성되는 canonical 값 |
| --- | --- |
| ‘독립 권역으로 만들기’ 해제, 상위 객체 없음 | `entityKind: general`, `parentId: ""`, `coverageMode: explicit` |
| 옵션 해제, 상위 일반객체 A 선택 | `entityKind: general`, `parentId: A`, 기본 `coverageMode: partition` |
| 옵션 선택 | `entityKind: regional`, `parentId: ""`, `coverageMode: explicit` |

새 생성 흐름은 옵션 해제·상위 객체 없음이 기본이다. ‘하위 객체 추가’는 같은
흐름에 부모 ID만 초기 입력한다. 독립 권역을 켜면 draft의 부모 선택을 비우고
부모 입력을 비활성화한다. 다시 끄면 부모 없음에서 시작한다.

체크 상태는 생성 draft의 `entityKind`를 표현하며 별도 Boolean을 프로젝트에
저장하지 않는다. 선택했던 원본 형상을 사용해 지방을 만들어도 원본 영토를
차감하지 않는다. 생성 취소는 프로젝트를 변경하지 않는다.

종류는 생성 시 결정한다. **기존 일반객체를 지방객체로 전환하는 기능은 제공하지
않는다.** 일반객체가 영토를 담당하는 역할을 잃어 빈 영역이 생기지 않도록,
필요한 권역은 원본을 유지하는 복사 생성으로 만든다. 이 전환을 후속 기능으로
예약하지 않는다. 지방→일반 전환도 이번 범위에 포함하지 않는다.
속성 화면에는 독립 권역 여부만 표시한다. 부모 변경으로 최상위/하위 위치가
달라지는 것은 종류 전환이 아니다.

### 독립 권역으로 복사

- 일반객체 하나의 편집 메뉴에 ‘독립 권역으로 복사’를 제공한다.
- 실행 시 원본의 현재 canonical geometry를 복사해 새 ID의 지방객체를 만든다. 화면 미리보기·단순화 geometry를 편집 원본으로 사용하지 않는다.
- 복사본은 `entityKind: regional`, `parentId: ""`, `coverageMode: explicit`이다. 부모·자식 트리를 복제하거나 원본의 영토 소속을 이전하지 않는다.
- 이름·스타일 등은 기존 객체 생성 흐름의 입력·기본값으로 처리하며, 원본 properties 전체를 무조건 복사하지 않는다.
- 원본의 ID·형상·종류·부모·자식·소속은 변경하지 않는다. 잠긴 원본도 읽기만 하므로 복사할 수 있고, 새 객체의 잠금은 생성 기본값을 따른다.
- 복사본은 독립된 형상 snapshot이다. 이후 원본 변경으로 갱신하지 않고 복사본 편집도 원본에 영향을 주지 않는다. 원본과의 동기화 관계를 저장하지 않는다.
- 기존 생성 명령·transaction·history·autosave 경로를 사용한다. 실패·취소 시 복사본을 일부 게시하지 않는다. 복사 생성의 Undo는 새 지방객체만 제거하고, Redo는 같은 새 ID와 복사 당시 형상을 복원한다.
- 이번 구현 대상은 단일 일반객체 복사다. 여러 일반객체의 합집합으로 권역을 만드는 기능은 별도 확장으로 남기며 이번 범위에 포함하지 않는다.

## 4. 형상·기간·transaction

### 형상

- 기존 canonical Polygon 계약인 닫힌 외곽 링 clockwise, 구멍 counterclockwise를 유지한다. 섬·구멍·날짜변경선 처리와 좌표 정밀도·검증 허용오차는 바꾸지 않는다.
- partition 자식 일반객체는 기존 허용 부모 범위 포함과 형제 간 중첩 방지 규칙을 따른다. 경계 공유는 면적 중첩이 아니다.
- explicit 자식 일반객체는 기본 자료의 명시 형상을 보존한다. 부모의 기본 geometry 밖에 있다는 이유만으로 자동 절단·삭제하지 않는다. 형상 유효성·관계·잠금·작업별 검증을 면제하는 의미는 아니다.
- 최상위 일반객체와 지방객체는 explicit이다. 일반객체 간 기존 영토 편집 검증은 유지하며, 이번 이름 통합으로 중첩을 무조건 허용하지 않는다.
- 관계만 바꾼다는 이유로 원본 좌표를 자동 재단·단순화하지 않는다. 형상 변경이 필요한 편입·분할은 해당 명령이 결과를 명시적으로 준비·검증한다.
- 자손 합집합 같은 유효 표시 범위는 파생 자료다. 엔티티가 직접 소유한 geometry를 렌더러가 덮어쓰지 않는다.

### 잠금·원자성·Undo

공통 명령은 최종 후보 상태에서 객체 자체 변경과 부모 체인에 따른 자손의
루트 변경을 함께 검사한다. 직접 수정하지 않은 잠긴 자손의 루트가 달라져도
전체 transaction을 거부한다. 단순 메타데이터 setter로 관계·형상 검증을
우회하지 않는다.

성공하면 관련 형상·관계를 한 번에 게시하고 기존 history·revision·invalidation·
autosave 경계를 따른다. 실패하면 일부 엔티티 변경이나 성공 이력 항목을 남기지
않는다. Undo/Redo는 ID·형상·관계를 함께 복원한다.

부모 변경 시 자손의 루트·계층·표시 범위 캐시를 기존 프로젝트 세대·리비전에
맞춰 무효화한다. 이전 프로젝트 또는 리비전의 Worker·preview 결과를 게시하지
않는다. 새 소속 저장 필드나 독립 revision 체계를 만들지 않는다.

### 기간별 관계

`validFrom/validTo`는 기존 `temporal.js`의 날짜·기간 검증을 따른다. null은
기간 경계 미지정이며 시작·종료 순서, 연도/날짜 형식과 기존 중첩 기간 검증을
유지한다.

기간별 관계도 동일 ID와 일반객체 부모 관계를 사용한다. 각 관계 기록과 같은
시점에 유효한 부모 체인에 대해 존재·종류·자기 참조·순환을 검증한다. 지방의
비어 있지 않은 부모와 국가 연결은 기간별 기록에서도 허용하지 않는다. 소속
국가·루트를 별도로 저장하지 않는다.

현재 조회는 현재 부모 그래프를 사용한다. 기간별 기록을 자동 적용하는 시간
재생이나 새로운 우선순위를 추가하지 않는다. 실제 기록 형식 전환은 단계 3에서
저장·복원·Undo·Worker 계약과 함께 수행한다.

## 5. 공통 API와 소유권

기존 [application command pipeline](application-command-pipeline.md)의
Repository·Store·ApplicationService 책임 분리를 유지한다.

| owner | 최종 계약 |
| --- | --- |
| Repository | `get(id)`, `list({kind?, parentId?})`, `parent(id)`, `children(id)`, `ancestors(id)`, `descendants(id)`, `root(id)`로 읽기 전용 조회·계층 탐색을 담당 |
| Store | `hasField(id, field)`, `setField(id, field, value)`, `isLocked(id)`, `setLocked(id, locked)`, `removeEntities(ids)`로 타입 인자 없이 동일 ID를 처리 |
| Store transaction | 기존 snapshot, transaction, applyChanges({features, removedIds}), appendEntities 책임 유지. 전체 교체는 replaceEntities, 부분 변경은 applyChanges |
| ApplicationService / command | 메타데이터와 관계·형상 명령을 구분하고 전체 영향 범위를 검증. entityKind는 생성 입력이며 생성 후 수정 명령은 제공하지 않음 |
| renderer / Worker | 공통 엔티티 snapshot으로 계산하며 canonical 모델을 직접 변경하지 않음 |

list의 kind 필터는 entityKind를 읽는다. 조회 대상 ID가 없으면 기존 단일
조회는 null, 목록은 빈 배열을 반환한다. 존재하는 객체의 깨진 참조·순환은
오류로 처리하며 임의의 루트를 반환하지 않는다.

root(id)는 일반객체의 최상위 일반객체를 반환한다. 지방객체는 부모가 없으므로
자기 자신이 root이며 이는 행정 소속이나 주권 판정이 아니다. 지방의 parent는
null, children/ancestors/descendants는 빈 배열이다.

선택·분포 등 공통 객체 참조는 `{ domain: 'territorial', type: 'entity', id }`다.
종류와 계층 위치는 Repository에서 조회한다. 계층 변경 때문에 선택 키나 참조
ID를 교체하지 않는다.

`administrativeCountry()`는 제거한다. 각 소비처가 필요로 하는 실제 의미에 따라
root, parent, ancestors 또는 표시 범위 조회를 사용한다. 모든 호출을 무조건
root로 치환하거나 옛 이름의 forwarding alias를 남기지 않는다.

## 6. 현행→최종 대응과 적용 시점

현재 기준은 단일 저장소와 unitType 3종류가 존재하는 cd85e14다.
이미 제거된 국가 override/별도 컬렉션을 이번에 새로 제거할 대상으로 적지 않는다.

| 현행 필드·API | 최종 방향 | 적용 시점 |
| --- | --- | --- |
| GeoJSON Feature, territorialEntities, 기존 Store/Repository | 유지. 별도 국가/하위단위/지방 저장소를 만들지 않음 | 전 단계 |
| unitType: country/subunit/region | 제거, entityKind: general/regional로 대체 | 단계 3 전체 계약 전환 |
| 국가/하위단위의 서로 다른 종류 | 동일 general, 부모 관계로 계층 표현 | 단계 3 |
| 지방 parentId, associatedCountryId | 부모는 빈 문자열, 국가 연결 필드 제거 | 단계 3, 기간별 관계 포함 |
| 일반객체 parentId | 같은 필드 유지, 모든 일반객체에 공통 관계 규칙 | 단계 3 |
| partition/explicit | 기존 형상 의미 유지, 최상위/지방은 explicit | 단계 3 명령·검증 전환 |
| ID·geometry·이름·메모·style·잠금·기간·metadata·출처 | 공통 필드 유지 | 전 단계 |
| Store setField(type,id,...) 등 타입 인자 | ID 중심 API로 대체 | 단계 2, 직접/간접 호출부 함께 변경 |
| Store 종류별 부분 교체 | 공통 applyChanges로 대체; 전체 snapshot 교체 유지 | 단계 2 |
| Repository 종류 필터·administrativeCountry() | kind 필터·목적별 계층/범위 조회로 대체 | 단계 3 |
| 종류별 선택·분포 참조 | territorial/entity/id로 통일 | 단계 3, 저장·Undo·Worker와 함께 |
| 현재 프로젝트 스키마 7 / 영역 모델 3 | 실제 새 형식 활성화 시 버전 갱신 | 단계 3, 최신 version-contract 재확인 |
| 국가/하위단위/지방 생성 버튼·폼 | 객체 생성·편집과 독립 권역 옵션 | 단계 3 필수 연결 후 단계 4 UI 통합 |
| 일반객체를 지방으로 바꾸는 종류 전환 경로 | 제거, 원본 유지·새 ID의 ‘독립 권역으로 복사’로 대체 | 단계 3 전환 금지·공통 생성 명령 연결, 단계 4 UI 연결 |
| 종류별 표시·강조·공간 인덱스 | 공통 ID·형상·계층 기반 표시 | 단계 3 필수 연결 후 단계 5 통합 |
| 옛 API·selector·fixture·문서 | 대체하는 변경에서 함께 제거·갱신 | 단계 2~5와 단계 6 최종 잔존 점검 |

구현 순서는 **계약 확정 → ID 중심 API 정리 → 모델·저장·Worker 전체 계약 전환
→ 생성·편집 UI 통합 → 표시·선택 통합 → 잔존 코드 정리**다.

단계 3은 명령·참조·저장·기본 자료·Worker·필수 표시 소비처까지 함께 바꾸는
하나의 전환 단위다. 중간 작업을 따로 배포하지 않는다. 옛 필드 별칭·이중 읽기·
이중 쓰기·구형 개발 프로젝트 migration은 추가하지 않는다.

## 7. 정상·오류 예제

아래 JSON은 관계 검토용 **필드 투영**이다. 생략한 공통 필드·모델 버전·형상·
기간은 유효하다고 가정한다. 현재 프로젝트로 불러올 수 있는 fixture가 아니다.

### A. 일반객체 계층과 부모 이동

```json
[
  { "id": "A", "properties": { "entityKind": "general", "parentId": "", "coverageMode": "explicit" } },
  { "id": "B", "properties": { "entityKind": "general", "parentId": "A", "coverageMode": "partition" } },
  { "id": "C", "properties": { "entityKind": "general", "parentId": "B", "coverageMode": "partition" } },
  { "id": "D", "properties": { "entityKind": "general", "parentId": "", "coverageMode": "explicit" } }
]
```

기대 결과: parent(C) = B, ancestors(C) = [B,A], root(C) = A.
관계 명령으로 B의 부모를 D로 바꾸고 최종 형상·잠금 검증까지 통과하면
root(B) = root(C) = D, C의 부모는 B다. B/C의 ID·entityKind·선택 참조는
유지한다. 새 부모의 partition 조건을 충족하지 못하면 전체 변경을 거부한다.

B를 최상위로 옮기는 명령은 parentId = "", coverageMode = explicit을
검증해 함께 적용한다. B의 ID와 general 종류는 유지한다. 이는 국가/하위단위
타입 전환이 아니다. Undo는 B의 이전 부모·coverageMode와 명령으로 변경한
관련 형상·관계를 복원한다.

### B. 직접 수정하지 않은 잠긴 자손

입력은 A의 예제에 C.properties.locked = true를 추가한 상태다.
B의 부모를 D로 바꾸면 C의 필드가 그대로여도 C의 root가 A에서 D로 바뀐다.

기대 결과: 전체 transaction 거부. B/C 및 관련 객체의 형상·부모·ID는 이전
상태를 유지하고 성공 이력·부분 저장은 남기지 않는다. C의 잠금을 해제한 뒤
모든 검증을 통과하면 A 예제의 정상 결과를 얻는다.

### C. 실레시아와 일반객체 편입

```json
{ "id": "silesia", "properties": {
  "entityKind": "regional", "name": "실레시아", "parentId": "", "coverageMode": "explicit"
} }
```

일반객체 P/Q/T의 일부와 겹치는 독립 geometry G를 직접 소유한다고 가정한다.
P가 Q의 일부를 편입하면 P/Q 형상은 검증된 결과로 바뀌지만 실레시아의
geometry G·ID·빈 parentId는 그대로다. Undo는 P/Q를 복원하며 G는 계속 동일하다.
다른 지방 R과의 중첩, 일반객체 하나 안에만 위치한 상태도 허용한다.

### D. 오류 입력

| 입력·변경 | 기대 결과 |
| --- | --- |
| B의 부모를 지방 silesia로 지정 | 일반객체 부모 종류 위반, 거부 |
| silesia의 부모를 A 또는 다른 지방으로 지정 | 지방은 독립 객체만 허용, 거부 |
| B의 부모를 missing으로 지정 | 누락 참조, 거부 |
| B의 부모를 B 또는 자손 C로 지정 | 자기 참조 또는 순환, 거부 |
| 일반과 지방이 같은 ID 사용 | 종류와 무관한 중복 ID, 거부 |
| 지방에 associatedCountryId 또는 일반에 sovereignId 저장 | 최종 필드 계약 위반, 거부 |
| unitType만 있는 옛 객체 입력 | 새 모델 입력으로 수용하지 않음 |
| 최상위 general 또는 regional에 partition 지정 | coverageMode 계약 위반, 거부 |
| A만 삭제하고 B의 parentId를 A로 남김 | 고아 관계가 남으므로 transaction 거부 |
| 생성된 general을 regional로 수정 | 금지된 종류 전환, 거부. 원본을 유지하는 독립 권역 복사 생성을 사용 |

같은 금지 관계는 기간별 기록에도 적용한다. 기간 기록의 존재로 현재 객체의
부모가 자동 변경되지는 않는다.

### E. partition과 explicit

| 형상 입력 | 기대 결과 |
| --- | --- |
| A 허용 범위 안의 partition 자식 B/C가 면적 중첩 없이 경계 공유 | 해당 형상 조건 통과 |
| partition B가 허용 부모 범위 밖으로 나감 | 포함 검증 실패 |
| 같은 부모의 partition 자식 B/C가 유의미한 면적으로 중첩 | 기존 허용오차에 따른 중첩 검증 실패 |
| 기본 자료의 explicit 자식 B가 A의 기본 geometry 밖에 별도 형상을 가짐 | 자동 절단하지 않음; 관계·유효성·작업별 검증은 별도로 수행 |
| regional R이 A/B/C와 겹침 | 소유권 중첩 오류로 처리하지 않음 |

이 표의 B/C는 형상 조건별 독립 사례이며 A 예제의 중첩 계층을 재사용한 것이 아니다.

### F. 생성 옵션·ID·Undo

상위 객체 A를 고른 일반 생성 draft에서 독립 권역을 켜면 부모를 비우고
regional/explicit로 생성한다. 다시 끄면 부모 없는 general/explicit가 된다.
‘하위 객체 추가’는 general/parentId A/partition을 초기값으로 사용한다.

생성 성공마다 새 고유 ID를 부여한다. 생성 Undo는 생성 전 모델·관계를 복원하고,
Redo는 같은 생성 ID를 복원한다. 생성 후 편집·부모 이동에서는 기존 ID와
territorial/entity/id 참조를 유지한다. 옵션 상태를 따로 저장하지 않는다.

### G. 복사 생성과 원본 유지

입력은 부모 A와 자식 C를 가진 일반객체 B, B의 현재 canonical 형상 G다.
‘독립 권역으로 복사’ 성공 후 새 ID R은 regional/빈 parentId/explicit이며
G와 동일한 좌표의 독립 형상을 가진다. A/B/C의 ID·형상·관계는 변경하지 않는다.

그 뒤 B의 경계를 편집해도 R은 G를 유지하며, R을 편집해도 B는 변경되지 않는다.
복사 생성 직후 Undo하면 R만 제거되고 A/B/C는 그대로다. Redo는 같은 R ID와
복사 당시 G를 복원한다. 복사 생성 실패·취소 시 A/B/C와 컬렉션은 변경 전 상태다.
이는 동일 객체의 타입 교체 또는 영토 이전이 아니다.

## 8. 1단계 완료 기준

두 종류의 필드·관계·API·생성 규칙, 정상/오류 예제와 현행→최종 적용 시점이
이 문서와 순차 계획에서 일치하면 문서 단계가 완료된다. 이후 단계의 실행 코드
전환·사용자 흐름 검증까지 완료된 것으로 보고하지 않는다.
