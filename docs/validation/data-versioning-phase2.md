# 데이터 버전 관리 2단계 — 웹 독립 데이터 번들 생성 경로

> 2026-10-08. 대상: `kimjeon-il/Pando`의 `work/gis`. 이 단계는 **기존 웹 런타임 로더를 변경하지 않는 병행 경로**다. `main`으로 구현 코드 병합이나 파일 삭제·배포는 포함하지 않는다.

## 도입된 계약

- `assets/data/world/build-input.json`: 현재 승인된 국가 정본의 생성 경로를 고정한다. 처음에는 레거시 `world-preview-v0.36.0.json`과 공유 국경선 캐시 `v0.34.0`을 입력으로 사용한다. **입력의 파일명에 쓰인 구버전은 출처 식별자이며 새 번들/객체의 앱 버전이 아니다.**
- `tools/build-world-bundle.mjs`: 입력 매니페스트, `territorial-entities/generated/current-world.geojson`, 실제 바이너리를 읽어 SHA-256/압축 해제 크기/바이너리 헤더를 검증하고, 바이트 SHA-256을 파일명에 포함한 불변 객체 5개를 만든다.
- `assets/data/world/current.json`: **프로그램 버전과 독립된** `pandolab-world-bundle` 스키마 1. 정본 SHA, 생성 알고리즘 정보, `defaultClassification`, 해시 기반 자산 경로·크기·압축 형식·SHA-256을 제공한다.
- `assets/data/world/objects/*-sha256-<64자리>.{geojson.gz,bin.gz,pcg.gz,json}`: 기존 기준 파일과 **완전히 같은 Blob**을 새로운 내용 기반 이름으로 참조한다. 원본 및 이전 배포 파일은 그대로 둔다.
- `tests/unit/world-bundle-versioning.test.mjs`: 앱 버전만 바뀐 경우 새 번들이 동일한지, 손상된 내용·경로 오류·정본 변경이 거부되는지, 생성/검사 재실행이 안정적인지 검증한다.
- `package.json`: `pnpm build:world-bundle`, `pnpm check:world-bundle` 추가. `build:map-assets` 마지막에 신규 발행, `check:preview` 마지막에 신규 무결성 검사를 추가한다.

## 읽기·쓰기 흐름

```text
country lineage source -> generated/current-world.geojson
  -> 기존 build-world-preview / build-world-mesh / build-country-shared-boundaries
  -> 고정된 레거시 manifest (전환기간의 원본 출처)
  -> build-world-bundle.mjs
      |- canonical source SHA 확인
      |- 5개 결과물의 실제 SHA-256, 압축 크기, 해제 크기, 헤더 검사
      |- content-addressed immutable world/objects/ 발행/재사용
      '- world/current.json 교체
```

- 재생성 시 동일한 자산의 해시는 변경되지 않으며 기존 경로를 다시 쓰지 않는다. 기존 파일이 다른 바이트라면 실패한다.
- `pnpm check:world-bundle`은 대상이 존재하고 내용이 정본과 일치하는지 **검사만** 한다. 파일을 다시 쓰지 않는다.
- 정본/기존 생성물이 달라져 입력이 낡아지면 무조건 실패한다. 새 데이터에 맞춰 실제 생성기를 실행한 후, 필요한 경우 `node tools/build-world-bundle.mjs --source-manifest=world-preview-v<새기준>.json`으로 고정 입력을 갱신한다.
- `world/current.json`은 여러 불변 객체를 묶는 변경 가능한 **진입점**이다. 이전 데이터 묶음은 종전 객체를 유지한 채 Git 이력/릴리스에서 재현한다.

## 단계 경계 / 남은 작업

**2단계에서 이미 확보한 것:** 앱 버전과 독립된 새 번들 계약/생성·검증 CLI, 해시 기반 객체 5개, 기존 데이터 완전 보존, 신규 검사 연계.

**의도적으로 남긴 것:**
- 실제 웹 Worker는 여전히 `world-preview-v${APP_VERSION}.json`을 읽는다. 3단계에서 `world/current.json` 기반으로 전환하며 원본 검증·재시도·기존 사용자 캐시와의 양립을 검사한다.
- 이전 `tools/build-world-preview.mjs`는 기존 배포 호환을 위해 앱 버전별 파일을 생성한다. 3단계 전환 완료 후 배포 호환 범위를 확인하고 생산자/검증기의 구 버전 의존성을 제거한다.
- 공유 국경선 cache는 현재 `v0.34.0` 레거시 참조를 `compatibility.sharedBoundaries`에만 기록한다. 3단계에서 생성기·렌더러를 해시/매니페스트 기준으로 옮긴다.
- 수계 `v0.13.0` 참조, 지형 raster·DEM 타일, 도시·지명, 역사 라이브러리, 앱 내장 패킷은 변경하지 않는다. 대량 구버전 삭제는 6단계까지 금지한다.
- 신규 자산과 옛 경로가 **전환기간에 공존하므로** 체크아웃/배포 크기는 일시적으로 늘어날 수 있다. 기존 Git Blob 자체는 같은 객체를 재사용한다.
- 현재 앱에 강제 적용하거나 앱 데이터의 출처·스키마를 자동으로 바꾸지 않는다. 앱 동기화는 4단계 대상.

## 검증 범위

개별 모듈과 함께 작성한 Node 단위 테스트는 버전 변화/오염/재실행을 검사한다. GitHub에 반영된 바이너리 별칭은 원본 Git Blob SHA를 재사용하므로 같은 바이트임이 Git tree로 확인 가능하다. 실제 CI·Playwright/Qt 빌드·전체 지도 시각 검사는 별도 결과를 보고할 때까지 완료로 기재하지 않는다.

**기준선:** [1단계 웹 인벤토리](data-versioning-phase1-inventory.md), [공통 진행 기록](../data-versioning-progress.md).
