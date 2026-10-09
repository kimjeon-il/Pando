# 구형 수계 전체 정리 — 3단계 실행·복원·배포 검증

- 적용일: 2026-10-09
- 웹 저장소: `kimjeon-il/Pando`, 웹 전 브랜치(당시 7개)
- 앱 저장소: `kimjeon-il/PandoEditor`, 데이터 내장 상태 유지(당시 5개)
- 기존 `assets/data/hydro/v0.12.2`~`v0.12.6` **모두 Git HEAD에서 제거**. Git 과거 커밋은 훼손하지 않음.

## 1. 실제 제거 내역

| 버전 | 삭제 파일 | 원본 bytes |
| --- | ---: | ---: |
| `v0.12.2` | 1,728 | 41,946,233 |
| `v0.12.3` | 13 | 41,628,073 |
| `v0.12.4` | 14 | 45,341,133 |
| `v0.12.5` | 7 | 13,088,876 |
| `v0.12.6` | 7 | 11,978,633 |
| **합계** | **1,769** | **153,982,948** |

삭제 뒤 모든 웹 브랜치에서 구형 수계 잔존 0개를 Git 트리로 확인. 현행 `v0.13.0` 7개와 `v0.13.1` 2개는 총 9개 그대로 유지. 앱 5개 브랜치는 현행 수계 원본 핀을 계속 유지하며 앱 자체의 데이터를 삭제하지 않았음.

## 2. 브랜치별 변경 원본 (롤백 기록)

| 브랜치 | 삭제 후 확인한 커밋 |
| --- | --- |
| main | `9ada45cfb4765ac891066d17585c4a71e1c0b2c3` |
| tmp/fetch-north-schleswig-west | `56897d73bcc361ab16e993f4b3c2943eca95b71b` |
| work/gis | `88cfef1502a12b6151ba392e235b9abb9e3a558b` |
| work/hydro-names | `ea4da806c3aa8780ec09a211f7bb470105b21cac` |
| work/objects | `f7d4c26e3c0a817922640576d87062617e4e1808` |
| work/places | `c2a01b0253bf71ffd7d76e8aabd624f2dfb3c183` |
| work/ui | `9a4f77602bf491b0d92d4c15df6e9c271a27bd84` |

위 커밋 이후에는 문서·검증 도구가 추가될 수 있으므로 이 표는 데이터 삭제를 마친 지점을 가리킴. 파일별 원본 Git Blob, SHA, 크기는 [2단계 증거 artifact](https://github.com/kimjeon-il/Pando/actions/runs/37907189047/artifacts/11605111244)에서 추적 가능. 역사적 원본 커밋은 `6dce59ea427e0728ef29bea31e2e51afbf27d9c8`.

## 3. 연구용 파일 27개의 실제 복원 검증

미리 준비된 복원 도구 `tools/restore-archival-hydro.py`는 불변 커밋의 v0.12.3·v0.12.4를 **프로젝트 외부**의 지정된 디렉터리에만 복원하며, Git Blob SHA-1을 각 파일 바이트에 대해 검증. 임의 덮어쓰기는 거부함.

- [복원 GitHub Actions #37913360459](https://github.com/kimjeon-il/Pando/actions/runs/37913360459): 단위검사 **4/4**, 과거 바이너리 **27/27, 86,969,206 bytes** 실제 복원 및 Git Blob 검증 성공.
- [검증된 복원 출처 JSON](https://github.com/kimjeon-il/Pando/actions/runs/37913360459/artifacts/11608645136).
- `tools/report-hydro-v0124.py`에는 `--hydro-root`, `tools/repack-water-v0125.py`에는 필수 `--source`·`--output`을 반영. 재포장 도구가 추적 중인 `assets/data` 아래에 구버전 파일을 다시 만들지 못하도록 막음.

복원 및 도구 사용 예시:

```bash
python3 tools/restore-archival-hydro.py --destination ../pando-hydro-archive --versions v0.12.3 v0.12.4
python3 tools/report-hydro-v0124.py --hydro-root ../pando-hydro-archive/hydro
python3 tools/repack-water-v0125.py --source ../pando-hydro-archive/hydro/v0.12.4 --natural-earth-root assets/data/hydro --output ../pando-legacy-output/v0.12.5
```

## 4. 게시 및 회귀 검증

- [최종 Pages 빌드·배포 #37913857515](https://github.com/kimjeon-il/Pando/actions/runs/37913857515): **성공**. 기존 main 루트 기반 게시 방식을 유지함.
- 삭제 이후 `main` 추적 파일 합계: **678,784,904 bytes**, `assets/data` 합계 **580,358,795 bytes**(상기 삭제 커밋 기준). Git 저장소의 과거 객체까지 자동 정리된다는 의미는 아님.
- `work/gis`의 [기존 Stage 6](https://github.com/kimjeon-il/Pando/actions/runs/37913511992), [Stage 7](https://github.com/kimjeon-il/Pando/actions/runs/37913511999), [Stage 8](https://github.com/kimjeon-il/Pando/actions/runs/37913512095), [Stage 9](https://github.com/kimjeon-il/Pando/actions/runs/37913512087), [Stage 10](https://github.com/kimjeon-il/Pando/actions/runs/37913512163) 데이터·배포 프리플라이트 모두 성공.
- 현재 구버전 URL은 정책상 영구 보존하지 않으며 404가 될 수 있음. 유효한 현재 수계 URL 접근은 새 Stage3 실서비스 검사에서 확인함.
- 전 브랜치 파일 삭제 회귀 검증기: `tools/check-retired-hydro.mjs`, `tests/unit/retired-hydro-stage3.test.mjs`, `.github/workflows/retired-hydro-stage3-gate.yml`.
- [Stage3 현행 검사 #37914128229](https://github.com/kimjeon-il/Pando/actions/runs/37914128229) **성공**: Node 단위검사 **5/5**, 웹 7개 브랜치 구형 파일 0개·현행 9개, 앱 5개 고정 참조 일치. **Pages 현행 수계 URL HTTP 200, 구형 표본 URL HTTP 404**.
- [Stage3 원격 브랜치·실서비스 검사 JSON](https://github.com/kimjeon-il/Pando/actions/runs/37914128229/artifacts/11609435160).

## 5. 경계

- 앱 이전 릴리스 파일과 개별 사용자의 로컬 프로젝트 파일을 전수 검사한 것은 아님.
- 수계 v0.13.0·v0.13.1 원본 SHA·경로는 변경 없음. `main` 제품 코드 전체 병합, GitHub Pages Actions 게시 방식 전환, Git 과거 이력 재작성은 수행하지 않음.
- Stage2는 삭제 전 시점을 검사한 역사적 기준선. 삭제 이후의 현행 상태는 Stage3의 자동 검사로 추적.
