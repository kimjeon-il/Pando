# DEM 기반 지형 표시와 경량 대체 자료

웹과 `apps/editor`은 DEM `0.13.3`을 주 지형 자료로 사용한다. 대체 자료는
`assets/data/terrain-preview/v0.13.3-p1/`의 LOD 0·1 타일 8개와 manifest다.
총 크기는 **3,365,441 bytes**이며 32,000,000 bytes 한도를 적용한다.

## 자료와 출처

- DEM 고도·사전 계산 음영: 공개 `0.13.3` manifest가 지정하는 `0.13.0` 불변 타일.
- tint: `0.13.3`, SHA-256 `1ae4c70e05494917c11d3c6b32869db61bf4f9e7e4b0239f9b4bd2b9bec582f3`.
- 기본 미리보기 육지 마스크: `countries-ne-5.1.1.geojson`, SHA-256 `6d29c349478cb2a7899573544ba580da70bd902c12ee86a4a93662ca6e94ad72`.
- 미리보기 원본 커밋: `e07ca47faa2c586751a7bebdf5f6eba479102976`.
- 미리보기 manifest SHA-256: `05e3a657287151c29c338caaec9c5d7cd22d4144d7e2db8ecad536742fe6fee8`.

로컬 GeoTIFF는 생성 입력으로 사용하지 않는다. 생성기는 `contracts/terrain/preview-dem-source.json`과
`preview-dem-inventory.json`에 고정한 파일 크기와 SHA-256을 먼저 확인한다. LOD 전체에서 육지
마스크를 한 번 래스터화한 뒤 타일로 잘라, 1px gutter와 날짜변경선에서 같은
픽셀을 사용한다. 고도 값을 일반 이미지 색상처럼 축소하지 않는다.

미리보기는 무손실 WebP `raster-rgba-v1`이다. **RGB는 표시 색상, A는 흑백
음영 데이터**다. A를 화면 투명도로 사용하지 않는다. 정점·국가 geometry,
저장 형식과 사용자 편집 규칙에는 영향을 주지 않는다.

## 표시 경로

| 경로 | 주 자료 | 대체 및 교체 |
| --- | --- | --- |
| 웹 WebGL | 기존 DEM·tint·현재 장면 육지 마스크 | 기존 실패 경계에서 새 미리보기로 전환 |
| Canvas Worker | 미리보기 먼저, 이후 화면에 필요한 DEM | 고도에서 정착 음영을 계산해 메모리 타일 생성; 현재 장면의 육지 범위로 tint를 합성 |
| Worker 없는 Canvas | 미리보기 LOD 0, 이어 LOD 1 | DEM 상세 생성 없이 확대·회전해서 표시 |
| WebView 앱 | 동일 웹 렌더러·DEM 경로 | 앱 staging에 포함된 동일 미리보기 |

Canvas Worker는 상세 타일이 준비되기 전까지 미리보기를 유지한다. 상세
decoded cache는 96MiB로 제한하고, 현재 화면 타일이 한도를 넘으면 적절한
DEM LOD를 선택한다. 화면 밖의 요청은 취소하고 취소 결과를 채택하지 않는다.
타일 재시도는 기존 400ms 지수 backoff와 최대 3회 즉시 재시도 규칙을 사용한다.
Canvas 정착 음영은 기존 DEM shader의 cell-center 중앙 차분식과 극점 fallback을
사용한다. WebGL의 화면 내 bilinear sampling과 Canvas의 생성 타일 sampling은
플랫폼별 표시 구현으로 유지한다.

앱은 같은 웹 자료와 렌더러를 staging한다. 별도의 앱용 이미지 사본·미러를 생성하지 않는다.

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
