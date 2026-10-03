# TerritorialEntity 공통 계약

확정일: 2026-10-03. 현행 코드 확인 기준: `main` / `b515fac`.

이 문서는 국가·하위단위·지방을 하나의 `TerritorialEntity` 모델로 통합할
최종 계약이다. 현재 실행 코드에 이미 적용된 형식을 설명하는 문서는 아니다.
이번 산출물은 계약, 정상·오류 예제와 현행→최종 대응표이며, 실행 코드,
저장 데이터, 프로젝트 스키마와 모델 버전은 변경하지 않는다.

확정한 방향은 다음과 같다.

- 세 종류 모두 같은 GeoJSON `Feature` 구조를 사용한다.
- 하위단위의 소속 국가는 `parentId` 체인에서 계산한다.
- 지방의 독립 형상과 선택적 국가 연결은 유지한다.
- 처리 경로를 공통 계약으로 정리한 뒤, 물리 저장 데이터를 마지막에 통합한다.

## 1. 객체 구조와 필드

`TerritorialEntity`는 모델의 이름이다. 별도 클래스, 객체 포장 계층 또는
국가·하위단위별 엔티티 복사본을 추가하지 않는다.

```text
TerritorialEntity
  type: "Feature"
  id: string
  geometry: Polygon | MultiPolygon
  properties:
    schemaVersion: number
    unitType: "country" | "subunit" | "region"
    name: string
    notes: string
    parentId: string
    associatedCountryId: string
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

| 위치·필드 | 값과 기본값 | 의미·검증 |
| --- | --- | --- |
| `type` | `"Feature"` | GeoJSON Feature 구조를 사용한다. |
| `id` | 비어 있지 않은 문자열, 기본값 없음 | 국가·하위단위·지방 전체에서 유일한 논리 ID. 누락·중복을 거부한다. |
| `geometry` | Polygon 또는 MultiPolygon, 기본값 없음 | 각 객체가 직접 소유하는 유효한 canonical 형상. 빈 형상은 정상 엔티티로 게시하지 않는다. |
| `properties.schemaVersion` | 공통 영역 모델 버전 | 실제 형식 전환 시 갱신한다. 현재 `TERRITORIAL_SCHEMA_VERSION = 2`를 이 문서 작성으로 바꾸지 않는다. 프로젝트 스키마 버전과 구분한다. |
| `properties.unitType` | `country`, `subunit`, `region`, 기본값 없음 | 종류에 따른 관계·작업 규칙을 판정한다. ID나 저장 위치로 종류를 추측하지 않는다. |
| `properties.name` | 문자열, `""` | 명시적 객체 이름. 이름이 같다고 동일 객체로 취급하지 않는다. 빈 이름의 표시 문구는 presentation 책임이다. |
| `properties.notes` | 문자열, `""` | 사용자 메모. |
| `properties.parentId` | 문자열, `""` | 종류별 규칙에 따른 상위 객체 참조. 비어 있지 않으면 실제 엔티티가 있어야 한다. |
| `properties.associatedCountryId` | 문자열, `""` | 지방의 선택적 국가 연결만 저장한다. 국가·하위단위에서는 항상 비어 있어야 한다. |
| `properties.coverageMode` | 국가·지방은 `explicit`; 하위단위는 기본 `partition` | 기존 `partition`·`explicit`의 형상 의미를 유지한다. 기본 자료처럼 명시적으로 생성한 `explicit` 하위단위도 유효하다. |
| `properties.style` | 객체, `{}` | 명시적 색상 등 현재 객체 스타일 계약을 사용한다. 상속·테마·최종 합성 결과를 저장하지 않는다. |
| `properties.locked` | Boolean, `false` | 현재 객체의 편집 잠금. 선택·가시성 상태와 구분한다. |
| `properties.validFrom`, `validTo` | 기존 날짜 문자열 또는 `null`, 기본 `null` | 기존 날짜 정규화·유효기간 검증을 사용한다. |
| `properties.metadata` | 객체, `{}` | 국기·수도·원본 부가정보의 기존 의미를 보존한다. 관계나 잠금의 대체 저장 위치로 사용하지 않는다. |
| `properties.sourceFolderId` | 문자열, `""` | 기존 출처 폴더 참조. 행정 부모가 아니다. |
| `properties.sourceLibraryId` | 문자열, `""` | 기존 자료 라이브러리 참조. 엔티티 ID가 아니다. |
| `properties.sourceGeometryVersion` | 문자열, `""` | 원본 형상 버전. 프로젝트의 변경 리비전이 아니다. |

국기 메타데이터의 명시적 `null`은 숨김, 키 없음은 기본값 복귀라는 현재
계약을 유지한다. `metadata.capital` 등 기존 부가정보를 새 엔티티 ID 참조로
임의 변환하지 않는다.

### 정체성과 비저장 값

종류 변경이나 편입 후 살아남은 객체는 원래 ID를 유지한다. 새 객체는 새
ID를 받으며, 작업 규칙에 따라 제거된 객체는 엔티티 컬렉션에서도 제거한다.
Undo는 제거된 객체의 원래 ID와 내용을 복원한다.

원본 자료 ID, GIS FID, `properties.pandolab_id`, GPU/SVG 표시용 ID는 논리
ID와 구분한다. 외부 자료의 식별자 대응은 가져오기·자료 로딩 경계에서
명시적으로 처리하고, 객체 조회가 대체 필드명을 차례로 시도하지 않는다.

가시성·선택·계산된 면적·계산된 소속 국가·계층 인덱스·GPU/SVG 패킷을
엔티티에 중복 저장하지 않는다. 각각 현재 presentation, selection,
Repository, renderer owner의 상태 또는 파생 자료로 유지한다.

## 2. 관계 규칙

### 국가

- `parentId = ""`, `associatedCountryId = ""`, `coverageMode = "explicit"`이다.
- `administrativeCountry(id)`의 결과는 자기 자신이다. 자기 ID를 소속
  국가 필드에 다시 저장하지 않는다.
- 정치적 종속·통제·임차·영유권 주장 등은 행정 부모 관계로 표현하지 않는다.
  출처 메타데이터와 별도 정치 관계의 기존 의미를 유지한다.

### 하위단위

- `parentId`는 필수이며, 국가 또는 다른 하위단위를 가리킨다.
- 부모 체인은 유한하고 반드시 국가에 도달해야 한다. 지방을 행정 부모로
  지정하거나 국가에 도달하지 않는 체인을 만들 수 없다.
- 소속 국가는 부모 체인의 국가이다. 최종 모델에는 `sovereignId`, 소속
  국가의 별도 저장 필드 또는 `metadata` 안의 동등한 복사본을 두지 않는다.
- `associatedCountryId`는 비어 있다.
- 하위 트리의 소속 변경은 적절한 관계·영토 이전 명령이 검증한다. 메타데이터
  setter가 부모 하나를 바꿔 형상·잠금 검증을 우회하는 동작은 허용하지 않는다.

### 지방

- `coverageMode = "explicit"`이며 독립된 형상을 직접 소유한다.
- `parentId`는 선택적 명시 참조이다. 국가·하위단위·지방을 참조할 수 있으나,
  존재·자기 참조·순환 검증을 통과해야 한다. 행정 편입, 소속 국가 또는
  부모 형상 안에 들어간다는 의미를 자동으로 부여하지 않는다.
- `associatedCountryId`는 비어 있거나 실제 국가를 가리킨다. 하위단위·지방을
  이 필드의 대상으로 지정할 수 없다.
- `parentId`와 국가 연결은 독립적이다. 부모가 국가에 연결되어 있다는
  이유로 지방의 국가 연결을 자동으로 채우거나 덮어쓰지 않는다.
- 연결된 국가는 지방 geometry의 소유권 이전이나 자르기를 뜻하지 않는다.

### 공통 무결성

모든 비어 있지 않은 참조는 실제 엔티티로 해석되어야 한다. 중복 ID, 누락
참조, 자기 참조와 모든 종류의 `parentId` 순환을 거부한다. 삭제·종류 변경도
최종 후보 상태의 참조를 검증한다. 참조 대상을 제거할 경우 관계 정리까지
같은 transaction에 포함해야 하며, 남은 고아 관계를 정상 결과로 게시하지 않는다.

Repository의 `parent`, `children`, `ancestors`, `descendants`, `root`는
명시적 부모 그래프를 읽는다. 그 결과에 포함된 지방 참조를 하위단위의 행정
계층이나 국가 소속으로 재해석하지 않는다. `administrativeCountry`는 종류별
계약을 따라 계산한다.

## 3. 형상·기간 계약

### 형상

- 모든 종류는 기존 경위도 좌표의 Polygon/MultiPolygon을 직접 소유한다.
  좌표 정밀도·날짜변경선 처리·검증 허용오차를 이번 계약으로 변경하지 않는다.
- 기존 canonical 계약인 닫힌 외곽 링 clockwise, 구멍 counterclockwise를
  따른다. 섬·구멍·다중 Polygon 구조를 유지한다. renderer에서 종류별로
  링을 뒤집거나 complement를 보정하는 경로를 추가하지 않는다.
- `partition` 하위단위는 기존 허용 부모 범위 포함과 같은 부모의 하위단위
  간 중첩 방지 규칙을 따른다. 경계를 공유하는 것은 면적 중첩이 아니다.
- `explicit` 하위단위는 기본 자료의 별도 영토 등 명시 형상을 보존한다.
  부모의 기본 geometry 밖에 있다는 이유만으로 잘라내거나 버리지 않는다.
  이 모드는 형상 자체의 유효성·관계·잠금·작업별 검증을 면제하지 않는다.
- 지방과 국가·하위단위 사이의 중첩을 국가 간 중복 소유로 일괄 판정하지
  않는다. 독립 지방의 명시 형상 의미를 유지한다.
- 부모 또는 국가 연결만 변경하는 작업이 형상을 자동 재단하거나 단순화하지
  않는다. 영토 이전에 필요한 형상 변경은 해당 geometry transaction이
  명시적으로 준비·검증·게시한다.
- 국가의 유효 표시 범위가 자손 형상의 합집합을 사용하는 경우에도 그 범위는
  파생 자료이다. 국가의 직접 저장 geometry를 몰래 덮어쓰지 않는다.

### 기간과 기간별 관계

`validFrom`·`validTo`는 현재 `temporal.js`의 계약을 사용한다. 연도 또는
날짜 형식, 확장·음수 연도, 연도 0 거부, 시작이 종료보다 늦을 수 없다는
조건을 유지한다. `null`은 해당 방향의 기간 경계 미지정이다.

기간별 관계 기록은 동일 엔티티 ID를 참조하며 부모 종류·존재·순환 규칙을
동일하게 적용하는 방향으로 정리한다. 최종 기록에서도 하위단위의 소속
국가는 해당 관계의 부모 체인으로 계산하고 `sovereignId`를 중복 저장하지
않는다. 지방의 국가 연결은 명시적 연결로 구분한다. 현재 기록의 대상 ID,
기간과 중첩 기간 검증은 보존한다.

이 문서는 기간별 관계를 현재 엔티티의 `parentId` 위에 자동 적용하는
우선순위나 시간 재생 기능을 추가하지 않는다. 현재 조회는 현재 부모 그래프를
사용한다. 기간별 관계의 실제 저장 형식 전환은 마지막 데이터 통합 단계에서
일반 엔티티 참조와 함께 처리한다.

## 4. API·소유권·게시 계약

현재 [application command pipeline](application-command-pipeline.md)의
Repository·Store·ApplicationService 책임 분리를 유지한다.

| owner | 계약 |
| --- | --- |
| Repository | 모든 종류의 공통 엔티티 조회와 파생 계층 인덱스를 소유한다. 결과는 읽기 전용 계약이며 직접 수정해 문서를 변경하지 않는다. |
| Store | 필드·형상·관계·컬렉션의 실제 쓰기를 소유한다. 물리 저장 분리가 남은 동안에도 그 차이를 업무·UI의 두 저장 API로 확장하지 않는다. |
| ApplicationService / command | 메타데이터 검증과 실제 변경 명령을 소유한다. 관계·종류·형상 변경은 전용 명령으로 처리한다. |
| 기존 command pipeline / transaction | history, revision, render invalidation, autosave와 실패 rollback의 기존 경계를 유지한다. 별도 이력·자동저장 경로를 추가하지 않는다. |
| renderer / Worker | 현재 엔티티 또는 명시적 읽기 snapshot에서 계산한다. 파생 결과가 canonical 모델을 직접 변경하지 않는다. |

`administrativeCountry(id)`의 최종 의미는 다음과 같다.

| 대상 | 결과 |
| --- | --- |
| 국가 | 해당 국가 엔티티 |
| 하위단위 | `parentId` 체인에서 도달한 국가 엔티티 |
| 지방, 국가 연결 있음 | `associatedCountryId`가 가리키는 국가 엔티티 |
| 지방, 국가 연결 없음 | `null` |
| 조회 대상 ID 없음 | 기존 조회 계약에 따라 `null` |
| 존재하는 객체의 잘못된 참조·순환 | 검증/조회 오류. 빈 소속이나 임의 국가로 조용히 대체하지 않음 |

메타데이터 수정으로 `parentId`, `associatedCountryId`, `unitType` 또는
geometry 변경 검증을 우회하지 않는다. 관계·종류·형상 변경은 영향을 받는
객체와 참조를 함께 검증하고, 잠긴 객체를 변경하지 않으며, 한 transaction으로
게시한다. 실패하면 문서·이력·관련 형상에 일부 결과를 남기지 않는다.

부모 변경으로 자손 전체의 소속이 달라질 수 있다. 계산된 소속과 계층 인덱스는
현재 프로젝트 리비전·세대에 연결하여 무효화한다. Undo·Redo·프로젝트 교체도
같은 규칙을 사용하며, 이전 세대 또는 리비전의 늦은 계산 결과를 현재 결과로
게시하지 않는다. 이를 위해 새 canonical 소속 필드나 별도 revision 체계를
추가하지 않는다.

## 5. 현행→최종 대응과 적용 시점

아래 현행은 확인 기준 코드의 저장·조회 계약이다. 목표 필드가 현재 자동저장에
이미 존재한다고 가정하지 않는다.

| 현행 | 최종 | 적용 시점 |
| --- | --- | --- |
| 국가 raw Feature + `countryOverrides`를 공통 entity로 projection | 국가도 공통 entity의 필드·metadata·style을 직접 소유 | 처리 경로 통합 후, 마지막 물리 데이터 통합 |
| 국가 projection의 `sovereignId = id` | 저장 필드 제거, `administrativeCountry(id)`가 자기 자신 반환 | 공통 조회 경로 전환; 실제 저장 형식은 마지막 단계 |
| 하위단위 `parentId` + `sovereignId` | `parentId`만 관계의 source of truth; 소속은 계산 | 공통 소비처를 모두 전환한 뒤 실제 저장 필드 제거 |
| 지방의 `sovereignId` | `associatedCountryId` | 지방 소비처와 기간별 관계를 함께 전환; 실제 저장 형식은 마지막 단계 |
| 국가·하위단위·지방의 `parentId` | 종류별 의미와 존재·순환 규칙을 명시한 같은 필드 | 후속 공통 생성·관계 검증 경로 전환 |
| `partition`·`explicit` | 같은 값과 현재 형상 의미 유지 | 공통 검증 경로에서도 유지 |
| 국가 기간 raw properties / unit 기간 properties | 공통 `validFrom`·`validTo` | 처리 경로 전환 후 물리 데이터 통합 |
| 국가 override / unit metadata의 국기·수도 | 공통 `metadata`, 현재 값의 의미 보존 | 공통 소비처 전환 후 물리 데이터 통합 |
| `sourceFolderId`·`sourceLibraryId`·`sourceGeometryVersion` | 같은 출처 필드 | 생성·자료 변환과 마지막 데이터 통합에서 보존 |
| `countriesData`, `countryOverrides`, `territorialUnits` | 단일 canonical 엔티티 컬렉션 | 마지막 물리 데이터 통합; 이번 단계에서 컬렉션명을 새로 도입하지 않음 |
| 종류별 생성·정규화·조회 소비처 | 기존 canonical owner의 공통 계약 사용 | 후속 처리 경로 통합 |
| 기간별 관계의 하위단위 `sovereignId` | 부모 관계로 계산, 중복 소속 저장 제거 | 관련 소비처 전환 후 마지막 데이터 통합 |
| 공통 영역 모델 버전 2 / 현재 프로젝트 스키마 | 실제 새 형식에 맞는 버전 | 형식을 실제 활성화하는 단계; 이번 문서 단계에서 갱신하지 않음 |

후속 작업 순서는 **공통 생성·검증/조회/명령 소비처 정리 → 편집·표시·Worker
경계 정리 → 실제 저장·복원·Undo·GIS 데이터 통합**이다. 각 실제 변경에서는
현재 호출처를 함께 갱신하고 대체된 API·필드를 제거한다. 최종 인터페이스에
옛 `sovereignId` 별칭, fallback 필드명, 별도 국가 엔티티 API나 호환 reader를
남기지 않는다. 구형 개발 저장본용 migration은 별도 요청 없이 추가하지 않는다.

## 6. 정상·오류 예제

다음 JSON은 **최종 계약의 관계 검토용 필드 투영**이다. `Feature`의 geometry,
모델 버전과 나머지 공통 필드는 생략했다. 현재 프로젝트 파일로 직접 가져오기
위한 자료나 실행 테스트 fixture가 아니다. 별도 설명이 없으면 잠금은 해제되어
있고, 형상·기간은 종류별 검증을 통과하는 것으로 가정한다.

### A. 국가와 중첩 하위단위

```json
[
  { "id": "A", "unitType": "country", "parentId": "", "associatedCountryId": "" },
  { "id": "A-1", "unitType": "subunit", "parentId": "A", "associatedCountryId": "" },
  { "id": "A-1-1", "unitType": "subunit", "parentId": "A-1", "associatedCountryId": "" }
]
```

기대 결과: 세 객체 모두 정상이다. `administrativeCountry("A")`,
`administrativeCountry("A-1")`, `administrativeCountry("A-1-1")`는 모두
`A`를 반환한다. 엔티티에는 계산 결과 `A`를 별도 소속 필드로 쓰지 않는다.

### B. 하위 트리의 이동과 순환

입력은 A의 예제와 국가 `B`이다. 전용 이전 명령이 `A-1.parentId`를 `B`로
변경하고, 필요한 국가·하위단위 형상과 잠금·관계를 함께 검증한다.

기대 결과: 성공한 최종 상태에서 `A-1`과 `A-1-1`의 소속 국가는 모두 `B`다.
`A-1-1.parentId = "A-1"`은 유지하며 자손의 소속 필드를 일괄 수정하는
절차는 없다. 이 변경을 단순 metadata setter로 수행할 수 없다. `partition`
형상이 새 부모 범위를 벗어나거나 관련 잠긴 객체를 바꿔야 한다면 적용을 거부한다.

반대로 `A-1.parentId = "A-1-1"`은 두 객체 사이의 순환이므로 거부한다.
거부 후 부모와 형상·이력은 변경 전 상태를 유지한다.

### C. 잘못된 관계와 정체성

| 입력/변경 | 기대 결과 |
| --- | --- |
| 국가 `A.parentId = "B"` | 국가에 부모를 지정할 수 없으므로 거부 |
| `A-1.parentId = "R"`, `R.unitType = "region"` | 하위단위의 행정 부모 종류 위반으로 거부 |
| `A-1.parentId = "missing"` | 존재하지 않는 참조로 거부 |
| `A-1.parentId = ""` | 국가까지 연결되지 않는 하위단위이므로 거부 |
| `A-1.parentId = "A-1"` | 자기 참조로 거부 |
| 국가와 하위단위가 모두 `id = "A"` | 종류가 달라도 중복 ID이므로 거부 |
| 하위단위의 `associatedCountryId = "B"` | 소속 국가의 중복 저장을 허용하지 않으므로 거부 |
| 지방의 `associatedCountryId = "A-1"` | 국가가 아닌 연결 대상으로 거부 |
| 지방의 `associatedCountryId = "missing"` | 누락된 국가 연결로 거부 |
| 서로 부모로 지정한 두 지방 | 명시 참조도 순환을 허용하지 않으므로 거부 |

### D. 독립 지방과 국가 연결 지방

```json
[
  { "id": "R0", "unitType": "region", "parentId": "", "associatedCountryId": "" },
  { "id": "R1", "unitType": "region", "parentId": "", "associatedCountryId": "A" },
  { "id": "R2", "unitType": "region", "parentId": "R1", "associatedCountryId": "" }
]
```

국가 `A`가 존재하면 모두 정상이다. 소속 국가 조회는 `R0 → null`, `R1 → A`,
`R2 → null`이다. `R2`의 명시 부모가 `R1`이어도 국가 연결을 상속하지 않는다.
`R1`을 `A`에 연결하는 것만으로 지방 형상이 바뀌거나 `A.geometry`에 합쳐지지
않는다. 지방은 자체의 유효한 독립 형상을 유지한다.

### E. 두 형상 모드

| 입력 | 기대 결과 |
| --- | --- |
| `partition` 하위단위가 허용 부모 범위 안에 있으며 형제와 경계만 공유 | 정상 |
| 같은 객체의 일부가 허용 부모 범위를 벗어남 | 포함 검증 실패; 임의로 잘라 성공 처리하지 않음 |
| `partition` 하위단위가 같은 부모의 하위단위와 유의미한 면적을 중복 점유 | 중첩 검증 실패; 기존 검증 정밀도 유지 |
| 기본 자료의 `explicit` 하위단위가 부모의 기본 국가 geometry와 떨어진 별도 섬·영토를 소유 | 부모 밖이라는 이유만으로 삭제·재단하지 않음; 형상과 관계의 다른 검증은 필요 |
| 지방이 국가와 면적상 중첩 | 지방의 독립 명시 형상 의미로 판정; 국가 간 중복 영토로 일괄 거부하지 않음 |
| 어떤 종류든 비유한 좌표·무효 링·빈 geometry를 게시하려 함 | 형상 검증 실패; renderer 보정으로 숨기지 않음 |

### F. 종류 변경·잠금·원자성·Undo

입력은 `id = "A-1"`인 하위단위이다. 국가 승격 명령이 부모 제거,
`coverageMode = "explicit"`, 관련 국가 형상·자손 관계를 검증해 적용한다.

기대 결과: 승격된 국가의 ID는 계속 `A-1`이며 소속 국가 조회는 자기 자신이다.
자손의 `parentId = "A-1"`은 존재하는 국가를 참조한다. 잠금이나 형상·관계
검증 실패 시 변경은 전혀 게시하지 않는다. 성공 후 Undo는 종류·부모·관련
형상과 참조를 원래 상태로 함께 복원하고, 파생 소속·계층 캐시를 무효화한다.

지방으로 종류를 변경하는 경우에도 ID를 유지하며, 국가 연결은 명시적으로
결정한다. 이전 하위단위의 행정 부모를 지방의 소속 국가로 암묵 변환하지
않는다. 자식 하위단위가 지방을 행정 부모로 갖게 되는 변경은 관계 정리 없이
적용할 수 없다.

### G. 기간 검증

`validFrom = "2020"`, `validTo = "2021-12-31"`은 정상이다.
`validFrom = "2022"`, `validTo = "2021"`은 거부한다. 미지정 경계는 `null`로
표현하며 연도 `0000`은 기존 날짜 계약에 따라 거부한다. 이 기간 입력만으로
카메라·현재 부모 관계·표시 국가를 시간에 맞춰 자동 전환하지 않는다.

## 7. 완료 범위

세 종류의 필드·관계·형상 의미, owner와 조회 결과, 현행 필드의 유지·제거·대체
시점, 정상·오류 예제를 이 문서에 확정했다. 후속 구현은 이 계약과 현재
canonical owner를 사용하며 별도 모델·호환 API를 추가하지 않는다.

계약 확정 단계는 문서 작성과 내용 검토까지이다. 실행 테스트, 앱·Worker 수정,
자료 생성, schema 변경, 커밋·푸시·배포는 포함하지 않는다. 기존 미커밋 수정은
이 문서 작업과 독립적으로 보존한다.

## 8. 처리 경로·물리 저장 통합 구현

국가·하위단위·지방은 현재 `state.territorialEntities` 한 배열에 저장한다.
각 Feature는 geometry와 공통 properties를 직접 소유한다. 국가 속성 override,
별도 하위단위 저장 배열, 하위단위 소속 국가의 중복 저장은 제거했다.

| 책임 | 현재 공통 API |
| --- | --- |
| 분리된 속성을 가진 공통 읽기 모델 | Store `snapshot()` |
| ID·종류·계층·소속 조회 | Repository `get()`·`list()`·`parent()`·`administrativeCountry()` |
| 메타데이터·잠금·관계 수정 | ApplicationService → Store `setField()`·`setLocked()` |
| 검증된 형상·종류 변경 적용 | Store `applyChanges({ features, removedIds })` |
| 추가·삭제·범위 교체 | Store `appendEntities()`·`removeEntities()`·`replaceEntities()` |
| 여러 객체·자손을 함께 변경 | Store `transaction()` — 동기 계산 후 관계 검증·한 번 게시 |

조회값의 속성은 원본과 분리하고 geometry는 원본 참조를 공유한다. 읽기
모델을 수정해 저장하거나 좌표를 직접 변경하지 않는다. 관계 변경은 부모
체인을 검증하며 관련 자손·잠금·형상 검증은 기존 명령 owner가 수행한다.
국가 삭제와 자손 재배치 중 임시로 필요한 국가 참조는 transaction 내부에만
남는다. 최종 컬렉션에 누락 참조가 있으면 게시하지 않는다.

기간별 관계는 schema 2이며 하위단위에는 `parentId`만 저장한다. 지방의
선택적 국가 연결은 `associatedCountryId`이고 행정 부모와 독립적이다.

## 9. 저장·복원·Undo·Worker 계약

프로젝트 schema는 7, 영역 모델과 개별 Feature의 schema는 3이다.
전체 프로젝트·전체 자동저장은 `territorialEntities: Feature[]`를 저장한다.
기본 자료에 대한 자동저장은 다음 형태만 사용한다.

```js
entityDelta: { changed: [/* 공통 Feature */], removedIds: [/* 공통 ID */] }
```

형상뿐 아니라 이름·색·국기·메모·관계 변경도 같은 변경분에 포함한다.
기본 258개 canonical 국가를 기준으로 기본 하위단위 분류의 추가·삭제도
기록한다. 외부 전체 자료 프로젝트는 전체 저장 경로를 사용한다.
외부 전체 프로젝트의 `baseDataset`은 `external-territorial-entities`로 표시하여
저장 파일을 다시 열어도 기본 국가 자료의 변경분으로 해석하지 않는다.
원본 자료 설명은 `sourceInfo`에 유지한다. 일반 벡터 GIS를 새 프로젝트로
열 때도 공통 serializer와 필드 기본값을 사용한다.
옛 분리 저장 형식과 schema는 거부하며 migration·호환 reader를 유지하지 않는다.

Undo는 같은 공통 배열과 변경 ID 집합을 geometry snapshot pool로 보관한다.
복원은 Store에서 한 번 게시하고 소속·계층·렌더 캐시를 무효화한다.
리비전·세대는 기존 프로젝트 owner를 사용한다. 별도 소속 revision을 만들지 않는다.

편집 Worker에는 국가와 하위단위를 중복 전송하지 않는다. 공통 엔티티를
한 번 동기화하고 작업별 국가·단위 목록은 그 원본에서 파생한다. metadata
변경은 좌표를 재전송하지 않고 별도 patch로 보낸다. 형상 교체·프로젝트
교체·취소·Undo 뒤 이전 계산은 기존 revision·generation 규칙으로 폐기한다.

지형·기본 canonical 자산·미리보기·GPU 메시의 주소와 파일 형식은 그대로다.
표시용 미리보기 좌표는 편집·자동저장의 원본 컬렉션으로 게시하지 않는다.
GIS 내부 프로젝트 payload는 schema 7을 쓰고 별도 벡터 테이블은 공통
엔티티에서 파생한다. 가져오기의 임시 payload 쓰기와 실제 Store 게시는 구분한다.
