# 수계 v0.13.2 2파일 통합 및 v0.13.0/1 퇴역 — 최종 4단계 보고서

- 검증일: 2026-10-09
- 웹 저장소: `kimjeon-il/Pando` 7개 브랜치
- 앱 저장소: `kimjeon-il/PandoEditor` 5개 브랜치
- 선행 v0.12.2~v0.12.6 퇴역 완료. 본 단계의 대상은 v0.13.0 및 v0.13.1 배포 자산만 해당함.

## 정본 및 바이트 불변성

- **현행 배포 자료**: `assets/data/hydro/v0.13.2/manifest.json` (53,375 bytes, Git Blob `6f6606ad01be6a9e295995222bfa984876e8caff`) 및 `hydro.bin` (11,974,120 bytes, Git Blob `6e3365aed7fccc4ecb2faee71d730e31af6058b4`).
- `hydro.bin` SHA-256: `91c2268c6dbfdfa7fc6103d8ad0b4eeca71f6c522df5c0118db69a3654ff532a`.
- 하나의 파일 속 6개 구간: index, metadata-core, metadata-detail, shard-0/1/2. 각 구간은 기존 압축 바이트의 정확한 재사용이며 길이·오프셋·SHA-256을 매니페스트에 저장.
- 지형지물 16,548개, 도형 팩 902개, 내부 원본 샤드 3개. 독립 디코딩·형상·명칭 검증은 기존 테스트 그대로 유지.
- **생성기 입력 자료 별도 보존**: `rivers_base.geojson`, `lakes_base.geojson`, `hydronym-ko-overrides.json`, `osm-waterway-ko-v0.13.0.json`. 마지막 파일명에 옛 버전이 들어가도 구형 배포 패키지가 아니며 삭제 대상이 아님.

## 삭제된 구형 배포 파일

| 버전 | 파일 | Git HEAD에서 제거된 바이트 |
| --- | ---: | ---: |
| v0.13.0 | 7 | 12,045,791 |
| v0.13.1 | 2 | 782,600 |
| **합계** | **9** | **12,828,391** |

- 이미 정리됐던 웹 브랜치 5개 외에, 웹 `main`의 [삭제 커밋 34e226e](https://github.com/kimjeon-il/Pando/commit/34e226e7b1db43e19c1f0e1b5bd8f19ee2008d04)와 `work/gis`의 [삭제·엄격검사 커밋 9cf035b](https://github.com/kimjeon-il/Pando/commit/9cf035b64991daf445723e5b0f75bb1a71f69b61)으로 모든 웹 브랜치 구형 배포 파일 **0개**.
- 앱 5개 브랜치에는 이미 옛 패키지가 남아 있지 않았고, 모두 `v0.13.2` 2개 파일의 Git Blob과 SHA를 동일하게 유지.
- 웹 `main` 삭제 직후 트리 스냅샷의 추적 파일 총합: **678,054,003 bytes**; `assets/data`는 **579,557,899 bytes**. 이는 Git HEAD의 트리 값이며 Git 과거 객체 정리/GC의 실제 저장소 크기 감소를 뜻하지 않음.
- 이전 v0.12.2~v0.12.6와 이번 v0.13.0/1의 삭제는 배포 URL 영구보존 폐기 정책에 따름. 예전 URL은 404일 수 있으며 사용자의 별도 저장 프로젝트·기존 배포 앱 본문을 전수 검사한 것은 아님.
- **원본 복원 경로**: 불변 Git 커밋 `8de07030cccff5e7ec3c68e6beb6bb288c95afb2`. `tools/build-hydro-packfile.py --source`는 외부 아카이브에서 v0.13.1을 읽고 현행 통합파일의 일치를 `--check`로 확인할 수 있음. 퇴역된 v0.12.3/4는 `tools/restore-archival-hydro.py`의 기존 복원 루트를 유지.

## CI 및 실서비스 검증

- [배포 후 현재 통합 수계/앱 원본 검사 #37941637897](https://github.com/kimjeon-il/Pando/actions/runs/37941637897) — 성공, 현행 gzip 구성 요소의 바이트·SHA 검사.
- [웹7·앱5 브랜치와 Pages URL 검사 #37941637853](https://github.com/kimjeon-il/Pando/actions/runs/37941637853) — 성공. **모든 웹 브랜치 구형 0·현행 2, 모든 앱 브랜치 구형 0·현행 2**, Pages 최신 `manifest.json` 및 `hydro.bin` 모두 HTTP 200.
- [과거 연구·실물 디코더·하천 편집 #37940817970](https://github.com/kimjeon-il/Pando/actions/runs/37940817970) — 성공. 세르비아·크로아티아·몰도바 하천 분할 3/3, 명칭 후보 33개 검증.
- [웹 `main` Pages 배포 #37941216899](https://github.com/kimjeon-il/Pando/actions/runs/37941216899) — 성공, 기존 Pages 배포 방식 그대로 유지.
- 과거 앱 매니페스트 v0.13.1을 고정하던 GIS 6~10단계 CI는 `PandoEditor`의 불변 커밋 `20e32516d81e1249db5ee5d8f4fe4c19a01bcdc0`(v2 출처 기록, v0.13.2 핀)으로 교체. 국가·지형·수계 각 자산의 기존 SHA 비교는 유지.
- 갱신 후 GIS [6단계 #37941938293](https://github.com/kimjeon-il/Pando/actions/runs/37941938293), [7단계 #37941938227](https://github.com/kimjeon-il/Pando/actions/runs/37941938227), [8단계 #37941938413](https://github.com/kimjeon-il/Pando/actions/runs/37941938413), [9단계 #37941938411](https://github.com/kimjeon-il/Pando/actions/runs/37941938411), [10단계 #37941938295](https://github.com/kimjeon-il/Pando/actions/runs/37941938295) — 전부 성공.
- 과거 수계의 재유입을 막는 상시 검증: `tools/check-retired-hydro.mjs`, `tests/unit/retired-hydro-stage3.test.mjs`, `.github/workflows/retired-hydro-stage3-gate.yml`. v0.12.2~v0.12.6와 v0.13.0/1 모두 차단하며, v0.13.2의 정확히 2개와 앱의 버전별 매니페스트를 검증함.

## 작업 범위와 한계

이번 단계에서 현행 통합 바이너리, 도시·국경 형상·국가 계보·국경 편집 로직, 앱 UI 등 제품 코드는 변경하지 않음. 타 브랜치의 무관한 변경을 병합하지 않았으며 Git 이력을 강제 재작성하지 않음. 기타 과거 세계지도 자료·지형 자료는 별도 검토 범위임.
