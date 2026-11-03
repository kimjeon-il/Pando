# P1 — Hydro·DEM 전 실자료 검증 증거 및 원본 재생성 잔여 조건

검증 기준일: 2026-11-03  
대상: `kimjeon-il/Pando`, `work/gis` (실행 코드·검증기 변경만)  
고정 외부 자료 revision: `kimjeon-il/PandoLab-library-data@91c127ddbae902405de6e35b38940a59a8c0d021`  
변경 금지: `main`, Pages, 운영 자료 pin, 기배포 `hydro.bin`/DEM 타일 및 원본 데이터. 이번 작업에서는 변경하지 않았다.

## 범위별 최종 판정

| 범위 | 판정 | 실제 검증 범위 |
| --- | --- | --- |
| Hydro v0.13.4: 공개 패키지 전체 | **PASS** | 고정 원본 패키지의 모든 리소스 offset·길이·SHA 및 902개 pack의 모든 형상 복호화, 16,548개 피처/2,641,926개 좌표, 3,818개 하천 시스템, 1,355개 호수/162,852개 호수 좌표 |
| Hydro 압축 core: C++ 네이티브 배달 | **PASS** | 기존 동일 소스의 네이티브 `pando-hydro-encoding`을 빌드·패키지·실행. core 16,548개 피처, 701,500바이트 전달 압축 및 정책 검사 |
| Hydro 9개 지역: SHP·SHX·DBF·PRJ **실원본** SHA 비교 | **BLOCKED** | 공식 HydroSHEDS AF ZIP GitHub runner 다운로드 시 HTTP 403. 9×4=36개 원본 멤버 확인 결과라고 주장할 수 없음. 원본 멤버 변조/누락 거부 **합성** 단위 테스트는 통과 |
| Hydro 원본부터 9개 지역 전체 **재생성** | **NOT RUN** | 공식 원본 9개 및 생성 때 사용한 Natural Earth 원본 3개 레이어와 `HYP_HR_SR.tif` 원본이 필요. 현재 고정 자료 저장소에 자료 전체가 없으므로 재생성 결과 동일성은 주장하지 않음 |
| DEM v0.13.3: 공개 타일 전체 바이트 감사 | **PASS** | 6개 LOD, 1,280개 WebP, 총 854,964,279바이트 (manifest·tint 포함); 자산 집계 SHA 일치, 예상 외/누락 파일 거부 |
| DEM 공식 ETOPO 2022 GeoTIFF 획득 및 SHA 비교 | **PASS** | NOAA 원본 1,585,813,987바이트를 CI에서 실제 다운로드, 고정 SHA-256 일치 |
| DEM 6개 LOD 전체: C++ 이미지·경계 검증 | **PASS** | 1,280개 타일 전체 WebP 네이티브 복호화·채널·양자화·인접 gutter·날짜변경선·극지 경계 검사; 지정된 4개 LOD5 표본 고도에서 원본 ETOPO 픽셀 대조, `verified: true` |
| DEM 원본부터 1,280개 타일 전체 **재생성·픽셀 완전 대조** | **NOT RUN** | 전체 ETOPO 원본 픽셀의 LOD 집계 재생성과 틴트 원본/육지 마스크가 포함된 생성기 전량 재현은 수행하지 않음. 실자료 경계 검사 성공을 재생성 성공과 혼동하지 않음 |

## Hydro 실제 검증 데이터

- 배포 버전 `v0.13.4`, 원본 패키지 `hydro.bin`: 11,972,285바이트.
- 패키지 SHA-256: `82cd70c2c0434ecfbc6e8be53843527c2dc0318ecdf814731a8c7441295230e2`.
- manifest SHA-256: `3ce36ed3ec3a711af62fff39bcbd05a4f7d7b21ffb3107258d2b9453dd172afc`.
- 전수 피처 16,548, 강 피처 15,193, 호수 피처 1,355, 수계 시스템 3,818, 논리 객체 5,173, 압축 pack 902, 전체 좌표 2,641,926, 호수 좌표 162,852.
- 아프리카·북극·아시아·오스트랄라시아·유럽·그린란드·북미·남미·시베리아 총 9개 지역 원본 해시 영수증 36개가 **manifest에 존재**함을 확인. 36개 공식 원본 멤버의 실제 바이트 동일성 검사는 아직 미완료.
- 한반도 16개 수계 시스템·20개 종점 체인·호수 1개, 국경 플래그 1,303개 피처, 중복 FID·논리 ID·좌표 수 검사 통과. 이 1,303개 국경 플래그 검사는 공유 국경의 실제 공간적 일치 여부를 GEOS로 전수 대조한 검사가 아님.
- 네이티브 core 전달 `701500`바이트, `verifyHydroCoreDelivery` 통과.
- 성공한 [GitHub Actions P1 Hydro whole-published + native CI](https://github.com/kimjeon-il/Pando/actions/runs/41556627872) 및 저장된 `p1-hydro-full-publication` JSON 아티팩트.
- 실원본 자동 수집 최초 [GIS Hydro 공식 원본 시도](https://github.com/kimjeon-il/Pando/actions/runs/41555748696)의 AF ZIP은 403으로 실패. 이 실패는 원본 SHA 불일치가 아니라 다운로드 거부. 이후 원본 수집 Job은 `workflow_dispatch` 전용으로 분리함. 출처 확인이 된 로컬/외부 원본을 확보하면 `verify-p1-hydro-originals.mjs`로 9×4개 모두 별도 검증한다.

## DEM 실제 검증 데이터

- 배포 버전 `v0.13.3`, `terrain/v0.13.3/manifest.json` SHA-256: `e63ac5f18188bd55c8eb032ad0a9e1a6bfb14232b617758ca9076e35771391ff`.
- 각 LOD 실제 타일 수: 0=2, 1=6, 2=18, 3=66, 4=242, 5=946; 합계 1,280개.
- tint `tint.webp` 2,433,794바이트. 전체 배포 `854964279`바이트.
- 집계 SHA-256: `622a6d272bdda6b507a1f4ba49794fe9ef41aca06f29d8b38e24114caa50d023`.
- NOAA ETOPO 원본: 1,585,813,987바이트, SHA-256 `8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2`, CI에서 실제 다운로드 후 대조.
- `tools/verify-terrain-dem.mjs`는 GDAL의 `gdallocationinfo`와 네이티브 `pando-map-image`, `pando-terrain-dem-check`를 실제 구축·호출하여 6단계의 모든 WebP 타일 형식, 채널 및 경계 규칙을 검증. 원본의 LOD5 지정 4개 표본 고도를 대조함.
- [GitHub Actions P1 DEM full published + NOAA ETOPO native CI](https://github.com/kimjeon-il/Pando/actions/runs/41556056754) 성공, `p1-dem-entire-release-and-etopo-proof` 아티팩트로 byte/네이티브 결과 JSON 보존.

## 재실행 방법 (원본 변경 금지)

```sh
# 현재 고정 버전 외부 자료 마운트 완료 후:
node tools/gis/verify-p1-hydro-publication.mjs \
  --directory assets/data/hydro/v0.13.4 \
  --output /new/external/report-hydro.json

# C++ native core 전달 검사 시 PANDO_HYDRO_ENCODING_DIRECTORY 지정 필요.
# 실제 Hydro 9개 지역 원본 확보 시 (지역별 하위 디렉터리, 원본 4멤버):
node tools/gis/verify-p1-hydro-originals.mjs \
  --manifest assets/data/hydro/v0.13.4/manifest.json \
  --originals /source/HydroRIVERS \
  --output /new/external/report-hydro-originals.json

# 실제 DEM 전체 데이터 마운트 후:
node tools/gis/verify-p1-dem-publication.mjs \
  --directory /source/terrain/v0.13.3 \
  --output /new/external/report-dem.json

# NOAA ETOPO와 네이티브 C++ SDK·GDAL이 준비된 환경:
node tools/verify-terrain-dem.mjs \
  --etopo /source/ETOPO_2022_v1_30s_N90W180_surface.tif \
  --output /source/terrain/v0.13.3
```

두 전체 실자료 CI 워크플로는 `.github/workflows/gis-p1-hydro-real-data.yml`, `.github/workflows/gis-p1-dem-real-data.yml`에 있으며, `work/gis`에서 재실행·아티팩트 검토가 가능하다. 원본 수집 및 재생성은 별도의 검증·출처 승인을 필요로 한다.

## 남은 실원본 완전 재현 작업 (독립 후속)

1. **Hydro 공식 9개 지역 수집 제한 해결**: 신뢰할 수 있는 공식 서버나 승인된 고정 원본 저장소에서 `HydroRIVERS_v10_{af,ar,as,au,eu,gr,na,sa,si}.{shp,shx,dbf,prj}`를 확보하고 SHA 36개 모두 비교. 다운로드가 403인 현행 GitHub Runner에서는 성공으로 간주하지 않는다.
2. **Hydro 완전 재생성**: 원래 Natural Earth `rivers_base.geojson`, `lakes_base.geojson`, `countries-ne-5.1.1.geojson`, 독립 명칭 입력 및 `HYP_HR_SR.tif`를 출처·해시로 고정한 뒤 `tools/gis/build-hydro.mjs`를 별도 스테이징에서 실행. 재생성 결과는 OSM 명칭 관련 의도된 `v0.13.4` 변경만 허용하고, 형태·ID·순서·패키지 바이트 차이는 별도 기록한다.
3. **DEM 픽셀 완전 재생성**: 확보된 ETOPO 원본에 HYP_HR, 빙하·국가 마스크 승인 원본을 합치고 `scripts/gis/run-source.mjs --task terrain-dem --execute`를 새 스테이징 경로에 실행. 전체 1,280개 WebP의 고도·음영·Gutter·tint를 승인본과 비교하며 전체 규모 성능을 기록한다.
4. 운영 재게시·기존 자료 핀 갱신·`main` 병합은 위 추가 작업과 별개의 명시적 승인 절차다.

**결론:** 현행 실제 *게시 자료* Hydro/DEM 전수 무결성 검사와 DEM의 실제 NOAA 원본 표본·네이티브 전체 타일 규칙 검사는 **완료**. Hydro 원본 36개 실바이트 검증 및 두 파이프라인의 *원본부터 전 세계 전량 재생성 동등성*은 **미완료**로 구분한다.
