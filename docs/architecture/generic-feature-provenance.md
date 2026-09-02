# Generic Feature + Source Provenance

Generic Feature는 판도연구소의 일반 생성 객체가 아니라 **지원하지 않는 외부/구버전 geometry를 손실 없이 보존하기 위한 fallback**이다.

## 제품 규칙

정상적으로 의미를 판별할 수 있는 객체는 정식 domain에 저장한다.

- 국가·권역·행정구역·지방 → `territorial`
- 언어·민족·종교 분포 → `distribution`
- 강·호수 → `hydro`
- 지명 → `label`
- 의미를 확정할 수 없는 외부/구버전 객체만 → `generic`

`generic`은 `creatable: false`, `fallbackOnly: true`다. 추가 Surface에는 Generic 생성 항목을 제공하지 않는다. 일반 사용자 작업은 지도에서 보기, 잠금, 삭제와 기본 메타데이터 편집으로 제한한다. 영토 관계, 해안선 정합 등 의미 기반 작업은 Generic의 정식 기능이 아니다.

## Generic Feature v2

Canonical properties는 다음만 사용한다.

```text
schemaVersion
name
notes
color
locked
source
```

v1의 `role / ownerId / parentId / landBinding / topologyGroup`은 v2 의미 모델에서 제거한다. 기존 프로젝트를 읽을 때 이 값은 버리지 않고 `source.details.legacyGenericSemantics`에 보존한다. 기타 알 수 없는 구버전 속성도 `source.details.legacyProperties`에 보존한다.

프로젝트 전체 schema는 이번 단계에서 `3`을 유지한다. `landObjectModel`과 Generic Feature만 v2를 출력하며, 기존 v1 입력은 읽을 수 있다. 명시적인 프로젝트 migration chain은 다음 Versioning/Schema Migration 단계에서 다룬다.

## Source Provenance v1

모든 출처 표현의 공통 계약은 `source-provenance.js`가 소유한다.

```js
{
  schemaVersion: 1,
  kind: 'user' | 'builtin' | 'library' | 'gis' | 'legacy' | 'plugin' | 'unsupported',
  dataset: '',
  sourceId: '',
  sourceFormat: '',
  sourceType: '',
  version: '',
  importedAt: '',
  details: {}
}
```

알 수 없는 원본 필드는 삭제하지 않고 `details.unmappedSourceFields`로 이동한다. Generic Feature는 이 계약을 첫 canonical consumer로 사용한다. 다른 정식 domain의 기존 출처 필드는 데이터 migration 없이 당장 제거하지 않으며 이후 Import/Export 및 schema migration 단계에서 이 계약으로 합류시킨다.

## 호환성

- Generic v1 → 런타임 정규화 시 Generic v2로 승격한다.
- 구버전 의미 필드는 provenance details에 보존한다.
- v1 API를 호출하는 기존 코드 때문에 role/binding 조회 함수는 당분간 compatibility shim으로 남지만 canonical 저장 필드가 아니다.
- 구버전 Generic 영토 관계 UI는 DOM을 삭제하지 않고 숨겨 기존 `app.js` 참조를 깨지 않게 한다.
- 기존 강/호수 생성은 계속 `hydroEdits`로 들어가며 Generic으로 라우팅하지 않는다.

## 검사

`pnpm check:provenance`는 다음을 강제한다.

- Generic canonical schema v2
- Source Provenance schema v1
- Generic `fallbackOnly` / `creatable:false`
- Generic action 제한
- v1 의미/확장/source 메타데이터의 무손실 보존
- canonical v2 top-level 속성 allowlist
- project schema 및 runtime invariant의 provenance 검증
- 구버전 Generic 의미 UI 비노출
