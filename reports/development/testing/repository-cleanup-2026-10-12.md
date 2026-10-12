# 웹·앱 저장소 파일 및 Git 이력 정리 — 1~3단계

- 조사 기준: Web `b6ef69827bcc34b271d8a04a044b1acb4cc25ef5`, App `f124fdb42d8cf2de5d0294b2b26d37d992f3774f` (`main`과 `work/gis`가 각각 일치).
- 범위: 현행 파일 조사·입증된 미사용 파일 정리, 원본을 건드리지 않는 로컬 Git 이력 복제본 검증. 저장소 통합은 별도 단계.
- 판정 기준: 파일명이나 버전만으로 삭제하지 않는다. 현행 코드·Worker·매니페스트·생성기·테스트·CI·앱 고정 출처 및 유지 중인 작업 브랜치의 참조를 확인한다. 과거 공개 URL이 없어지는 결과는 [구버전 URL 정책](../../../docs/data-url-retention-policy.md)에 따라 해당 파일별로 기록한다.

## 1. 현행 파일 조사

`git ls-tree -r -l`로 고정 커밋의 Blob과 크기를 집계했다. Web 추적 파일에서 `assets/`는 1,864개·684,446,450 bytes, App `assets/`는 630개·53,312,774 bytes이다. 앱은 웹의 지형 타일 전체를 중복 보관하지 않으며, 세계 자료의 출처와 내장 파일은 `assets/world/manifest.json` 및 Qt 리소스 규칙으로 연결한다.

Web `tools/audit-legacy-gis-assets.mjs`는 데이터 997개·632,007,612 bytes를 검사했고 현재 지형 334개 타일과 매니페스트, 수계 `v0.13.2`, 앱 고정 출처를 확인했다. 1,016개 소스 파일을 조사해 미물질화 파일은 0개였다. 동일 Git Blob 8그룹의 경로상 중복은 57,147,752 bytes이지만 Git 객체는 이미 중복 저장하지 않는다. `world/objects`와 버전별 경로의 동일 바이트도 현행 매니페스트·호환 경로가 각각 필요하므로 중복만으로 삭제하지 않는다. App `tools/verify-world-assets.mjs`는 GIS 7개 항목과 2026-10 역사 세계 자료를 확인했다.

| 분류 | 확인한 내용 | 결정 |
| --- | --- | --- |
| 현행 Web 지형 | `terrain/v0.12.6/` 335개·367,620,868 bytes. 런타임·앱 출처·검증에서 참조 | 유지 |
| 현행 수계·세계 자료 | Web `hydro/v0.13.2`, `world/objects`, 현재 국가·미리보기; App 고정 출처·Qt 리소스 | 유지 |
| 생성 원본·연구·검증 | `territorial-entities/source`, 수계 원본, `reports/`, `tests/` 및 GIS 연구 자료 | 이 정리에서 유지 |
| 과거 버전과 과거 매니페스트 | 보관된 월드 매니페스트가 가리키는 구버전 국가·미리보기·메시 | 사용·복원 관계별 후속 검토. 일괄 삭제하지 않음 |
| 로컬 빌드·캐시 | Git 추적 대상이 아니며 다른 작업의 산출물일 수 있음 | 삭제하지 않음 |

### 개별 삭제 대상: 과거 세계 메시 1개

`assets/data/world-mesh-v0.10.2.bin.gz`는 14,626,600 bytes, Git Blob `e6b8c89be91db1eb9fd24c95684faf434e620fa4`이다. 현행 Web 코드·매니페스트·생성기·테스트·CI와 `main`, 모든 원격 `work/*` 브랜치의 자료 참조를 검사해 0건이었다. 현재 사용 메시 `v0.12.6`과 별도 파일이며, App에는 이 파일이 없다. 원본은 도입 커밋 `3423fb77c567b89bb06c20351815a6a1978d9922`를 포함한 원래 Git 이력에서 복구할 수 있다. 삭제 전 Pages URL은 HTTP 200·14,626,600 bytes였다. 삭제 후 이 과거 URL의 404는 위 정책상 허용하되, 현행 URL과 기능은 계속 검증한다.

이 외에 **삭제 준비가 입증된 파일은 0개**다. 특히 `world-mesh-preview-v0.30.0`·`v0.31.0`은 과거 `world-preview` 매니페스트가 참조하고, 구버전 국가 파일에도 고정 fixture·매니페스트 참조가 남는다. 과거 릴리스의 실제 소비 범위까지 확인되지 않은 항목은 목록에 남긴다.

## 2. 변경 및 검증 기록

Web `work/gis`의 `a932e5d5520b97272b952739e8775dffc86d8e10`에서 위 구형 메시만 제거했다. 커밋 후 `audit-legacy-gis-assets.mjs`는 **996개·617,381,012 bytes**, 현행 지형 타일 334개와 앱 고정 출처를 확인했다. 관련 Node 단위검사 **12/12 통과**. App은 제거할 현행 파일이 없어 소스 변경·새 포터블 패키지가 없으며, `verify-world-assets.mjs` **GIS 7항목 통과**, `verify-release-assets.mjs` **20/20 통과**, 기존 로컬 실행 파일의 `Pandoeditor-local.bat smoke` **종료 코드 0**이다. 이 smoke 검사는 새 빌드·패키지 검사가 아니다.

Web `main`·`work/gis` 원격은 `b122f37b25a5ded5d0d275ea57dd9ac2bf579cca`로 확인했다. 같은 커밋의 [Pages 실행 38210548128](https://github.com/kimjeon-il/Pando/actions/runs/38210548128)은 성공했고 Pages 최신 빌드 API도 `built`·동일 커밋을 반환했다. 공개 URL 확인 결과, [홈](https://kimjeon-il.github.io/Pando/)은 HTTP 200, 삭제한 [구형 메시](https://kimjeon-il.github.io/Pando/assets/data/world-mesh-v0.10.2.bin.gz)는 HTTP 404, 현행 [지형 매니페스트](https://kimjeon-il.github.io/Pando/assets/data/terrain/v0.12.6/manifest.json)와 [이 보고서](https://kimjeon-il.github.io/Pando/reports/development/testing/repository-cleanup-2026-10-12.md)는 HTTP 200이었다. 삭제 전 구형 메시 URL은 HTTP 200이었다. 이는 Pages와 파일 경로 검증이며 전체 웹 CI·모든 사용자 흐름의 통과를 뜻하지 않는다.

## 3. 격리된 Git 이력 정리

두 원본 저장소를 `--mirror --no-hardlinks`로 독립 복제했다. 두 복제본에서만 `git-filter-repo 2.47.0`으로 과거 경로를 제거했다. 로컬 복제본이 원본의 loose object까지 복사해 도구의 fresh-clone 판별을 통과하지 못했으므로, 절대 경로·bare 여부·입력 HEAD를 확인하고 복제본에서만 `--force`를 사용했다. 도구가 복제본의 `origin` 원격 추적 ref를 제거했으며, 원본 원격은 변경하지 않았다.

| 복제본 | 과거 이력 제거 경로 | 원본 객체 디렉터리 | 정리 복제본 객체 디렉터리 | 차이 |
| --- | --- | ---: | ---: | ---: |
| Web `D:/dev/history-audit/Pando-web-20261012-a932e5d5.git` | `assets/data/terrain/v0.12.0/` (과거 335개·374,094,147 bytes) | 1,356,546,173 bytes | 829,110,766 bytes | 527,435,407 bytes |
| App `D:/dev/history-audit/Pando-app-20261012-f124fdb4.git` | `dist/windows-portable/` (과거 태그의 1,385개·258,078,222 bytes) | 220,073,338 bytes | 60,919,225 bytes | 159,154,113 bytes |

이 차이는 **현재 원본 객체 디렉터리와 재압축된 복제본 디렉터리의 실측 차이**다. 압축·원본의 loose/도달 불가 객체 차이가 포함되므로 제거 경로만의 순수 절감량으로 해석하지 않는다. 웹의 과거 지형을 가리키던 Codex 임시 **tree ref 12개**는 재작성 도구가 처리하지 않아 옛 Blob을 계속 붙잡았다. 정확한 ref·원본 tree SHA를 별도 목록에 기록한 뒤 **복제본에서만** 제거하고 GC했다. 원본 ref는 유지된다.

검증: Web 로컬 브랜치 **19개**, App **13개**의 최종 tree SHA가 재작성 전과 같고, 제거 경로의 도달 가능한 Blob 경로 **0개**, 양쪽 `git fsck --full --no-reflogs` **종료 코드 0**이다. Web 현행 지형은 복제본에도 **335개**다. Web `work/gis`는 원본 `a932e5d5` → 복제본 `4560f0035c1b2f94afb83ca478735408008bb6d9`, App `main`은 원본 `f124fdb4` → 복제본 `eaae3852ca06c665bf69ac4e527582ee79c3fefd`로 대응한다. 전체 commit map과 입력 ref 목록은 각 복제본의 `filter-repo/commit-map` 및 `D:/dev/history-audit/`의 sidecar 목록에 남겼다. 재작성 SHA는 원래 GitHub 커밋·릴리스 태그의 대체물이 아니며, **원본 웹·앱 저장소와 GitHub 원격 이력은 변경하지 않았다**.

Web 복제본은 보고서 후속 커밋 `b122f37b` 이전의 `a932e5d5`에서 만들었다. 따라서 4단계에서 이력 정리본을 실제 통합 입력으로 채택한다면, 그때 선택한 최종 커밋에서 새 복제본을 만들어 재검증해야 한다. 영구 작업 트리가 없는 `work/auto-georef`·`work/hydro-names`는 이 단계에서 브랜치 끝을 이동하지 않았고, 과거 파일 삭제가 필요한지는 해당 작업과 합칠 때 다시 확인한다.
