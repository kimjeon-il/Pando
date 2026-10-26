# DEM 기반 지형 표시와 경량 대체 자료

웹의 지형은 DEM `0.13.3`을 주 자료로 사용한다. 앱의 지형 기능은 비활성 상태를 유지한다. 대체 자료는
`assets/data/terrain-preview/v0.13.3-p2/`의 LOD 0·1 타일 8개와 manifest다.
총 크기는 **4,457,248 bytes**이며 32,000,000 bytes 한도를 적용한다.

## 자료와 출처

- DEM 고도·사전 계산 음영: 공개 `0.13.3` manifest가 지정하는 `0.13.0` 불변 타일.
- tint: `0.13.3`, SHA-256 `1ae4c70e05494917c11d3c6b32869db61bf4f9e7e4b0239f9b4bd2b9bec582f3`.
- 기본 미리보기 육지 마스크: `countries-ne-5.1.1.geojson`, SHA-256 `52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb`.
- 미리보기 자료 커밋: `473b2babd37f0331af5e096ee4152a15af6a8d0f`.
- 미리보기 manifest SHA-256: `def32b86bebf84a24ceecaf68caac7a8d711b4bb355115f983d5d98e3d87a870`.

로컬 GeoTIFF는 생성 입력으로 사용하지 않는다. 생성기는 `contracts/terrain/preview-dem-source.json`과
`preview-dem-inventory.json`에 고정한 파일 크기와 SHA-256을 먼저 확인한다. LOD 전체에서 육지
마스크와 표시 픽셀을 메모리에서 계산한 뒤 타일로 잘라, 1px gutter와 날짜변경선에서 같은
픽셀을 사용한다. 원본 DEM·마스크 형상은 변경하지 않으며 고도 값을 일반 이미지 색상처럼 축소하지 않는다.

미리보기는 무손실 WebP `raster-rgba-v1`이다. **RGB는 표시 색상, A는 흑백
고도 명도와 음영을 합성한 데이터**다. A를 화면 투명도로 사용하지 않는다. 정점·국가 geometry,
저장 형식과 사용자 편집 규칙에는 영향을 주지 않는다.

## 표시 경로

| 경로 | 주 자료 | 대체 및 교체 |
| --- | --- | --- |
| 웹 WebGL | 기존 DEM·tint·현재 장면 육지 마스크 | 기존 실패 경계에서 새 미리보기로 전환 |
| Canvas Worker | 미리보기 먼저, 이후 화면에 필요한 DEM | 고도에서 정착 음영을 계산해 메모리 타일 생성; 현재 장면의 육지 범위로 tint를 합성 |
| Worker 없는 Canvas | 미리보기 LOD 0, 이어 LOD 1 | DEM 상세 생성 없이 확대·회전해서 표시 |
| 앱 웹셸 | 지형 메뉴·요청 없음 | 기능을 다시 활성화하지 않음 |

Canvas Worker는 상세 타일이 준비되기 전까지 미리보기를 유지한다. 상세
decoded cache는 기존 96MiB 예산으로 화면 밖 타일을 회수한다. 현재 화면의
보호 타일만으로 예산을 넘으면 해당 타일을 유지하며 카메라가 선택한 LOD를
낮추지 않는다. 화면 밖의 요청은 취소하고 취소 결과를 채택하지 않는다.
타일 재시도는 기존 400ms 지수 backoff와 최대 3회 즉시 재시도 규칙을 사용한다.
Canvas 음영은 DEM shader와 같은 cell-center 중앙 차분식과 극점 fallback을
사용한다. 모든 배율·조작 상태에서 경사를 2배 강조하고 북서·서·북·남서 음영을
0.55/0.20/0.15/0.10으로 혼합한다. 기본 밝기 0.27, 조명 성분 0.73,
중립값 대비 1.3배, 음영 범위 0.16~1과 색상 배율 0.38~1.3을 사용한다.
색채는 기존 tint 40%와 고도색 60%를 혼합하고 흑백은 고도 0~6000m에 따라
명도 0.58~0.88을 부여한다. 흰색은 적설 판정이 아니다.
극지방에서는 원본 B 음영의 조명 성분을 새 중립 밝기로 정규화한다.
WebGL은 RG 각각을 보간하지 않고 해독한 고도를 bilinear 보간한다.
WebGL의 화면 내 sampling과 Canvas의 생성 타일 sampling은
플랫폼별 표시 구현으로 유지한다.

별도의 앱용 이미지 사본·미러를 생성하지 않는다.

## 재실행

Python에 Pillow 12.3.0과 NumPy 2.3.5를 설치한 뒤 저장소 루트에서 실행한다.

```text
python tools/build-terrain-preview.py --check
python tools/build-terrain-preview.py --rebuild-check
python -m unittest tests.python.test_build_terrain_preview
node tools/check-terrain-preview.mjs --out terrain-preview-evidence.json
node --test tests/unit/terrain-preview-audit.test.mjs tests/unit/terrain-manifest.test.mjs tests/unit/canvas-terrain-dem-core.test.mjs tests/unit/physical-layer-service.test.mjs
pnpm exec playwright test tests/browser/terrain-preview.spec.mjs
```

검증용 DEM 원본 캐시는 `.terrain-preview-cache/source/`에 둔다. Playwright의
`test-results/` 정리 대상과 분리한다. 새 산출물 생성은 기존 파일을 덮어쓰지
않으며 `--output`으로 빈 출력 위치를 명시한다. 승인된 pin과 기대 해시는 자동
갱신하지 않는다.

앱의 staging·저장 연결 검사는 `apps/editor/tests/`에서 수행한다.

`terrain-preview-gate.yml`은 재생성·출처·폐기 자산·브라우저 표시를 확인한다.
Pages 필수 자산 검사도 새 manifest를 사용한다. 기존 v0.12.6 자료는 과거 증거이며 현행 배포 판정에 사용하지 않는다.
`v0.12.6` raster 원본은 Git 이력으로 복원 가능하다. 전환 후 과거 공개 URL은
보장하지 않는다. 이 변경의 구현 검증은 배포 성공을 뜻하지 않는다.
