> **2026-10-28 이행 갱신:** 1:10m 축척에 불필요한 1914년 독일 해안 WMS 마이크로타일·기간 래스터 조사, 세실리엔코크 미세 제방 조사에 대응한 Python 4개, GitHub Actions 2개, 전용 Node 단위 테스트 2개를 폐기했다. 아래 최초 매니페스트와 이전 단계별 전환안은 당시 기록이며 현행 실행 파일 목록이 아니다. 역사 GIS 기본 생성기와 실제 지도 검증은 계속 유지한다.

# Python 완전 제거 로드맵 — 판도연구소

> **기준:** 2026-10-25, `work/gis` 커밋 `61aa02a9fd098237f7ced6601db76ab4f94eeb65`  
> **상태:** 구현 전 계획. 이 문서 작성은 코드·자료·CI 변경을 뜻하지 않음.  
> **대상:** 저장소에 추적된 Python `.py` **101개 전수**. 5개 전환 묶음에 누락·중복 없이 분류함.  
> **결론:** 남겨두기라는 최종 상태는 없음. *기능을 다른 언어로 이식*하거나 *일회성 작업은 결과의 영구 보존·검증 후 원본 스크립트와 Actions를 종료*함.

## 2026-10-29 잔여 기준 목록

### 2026-10-30 재개 기준: 추적 Python 46개

`work/gis` 통합 기준 `2c41bf5f`: 도구 26개, 테스트 20개. 아래 행은 현재 추적 파일이며, 개수는 `git ls-files '*.py' '*.pyi' '*.ipynb'`로 다시 계산한다. 각 도구는 대체 구현과 실제 호출자 전환 후 대응 검사를 통과해야 삭제한다. 각 테스트는 같은 행에 명시한 동작 검사가 Node 또는 CTest에서 실제로 수행된 뒤 삭제한다. 원본 26개가 없는 역사 GIS 사례는 고정 사례와 보유 원본의 기능 동등성을 확인하되 빠진 실자료 검증을 별도 기록한다.

| 현재 경로 | 대체 소유자와 호출자 | 삭제 전 필수 검증 |
| --- | --- | --- |
| `plugins/pando-map-tools/lib/raster.py` | 공통 C++ 이미지/PDF 도구; 지도 분석 플러그인 | EXIF, 페이지, crop, 투명도, GeoPDF 좌표와 원본 출력 비교 |
| `tools/qgis/bootstrap.py`, `tools/qgis/bridge.py` | 네이티브 QGIS 플러그인과 Node CLI/MCP; QGIS 실행 설정 | 실제 사용 편집·처리, 인증, 좌표·ID·출처, 내보내기 왕복 |
| `tools/build-hydro-tiles.py`, `tools/calibrate-hydro.py`, `tools/hydro_connectivity.py` | 공통 C++ 수계 계산과 Node 생성·출처 관리; 생성 명령과 Actions | 논리 ID, 양자화, 압축·바이너리 순서, 이름, 교정·연결 고정 사례 |
| `tools/repair-hydro-connectivity.py`, `tools/verify-hydro-connectivity.py` | 같은 C++ 수계 엔진과 Node 복구·검증 명령; Actions | 전후 연결, 거부·오류와 실자료 선택 범위 비교 |
| `tools/build-physical-data.py`, `tools/build-terrain-dem.py`, `tools/build-terrain-preview.py`, `tools/verify-terrain-dem.py` | 선택형 GDAL C++ 지형 도구와 Node 실행 관리; 생성·검증 Actions | NoData, 틴트·마스크, 극지 gutter, LOD 0–5, RGBA와 인코딩 차이 |
| `tools/build_german_empire_1914_modern_coast.py`, `tools/supplement-lsib-boundaries.py`, `tools/verify-lsib-screen-delta.py` | C++ 영토 레시피·GEOS와 Node 출처·검증; 역사 GIS 명령 | ID·기간·귀속·위상, 화면 차이, 고정 사례 및 보유 원본 |
| `tools/library_data.py`, `tools/report_paths.py` | 기존 Node 자료 lease·보고서 경로 정본; 마지막 Python 호출자 | lease·권한·독립 판본·원본 보존, 마지막 Python 호출 제거 |
| `tools/reference-analysis/corpus.py` | Node 코퍼스·계보·검토 소유자와 C++ 래스터화; 수집·학습 호출자 | 원본·라벨 해시, 누수 방지, 리뷰·known/ignore, 출처와 덮어쓰기 거부 |
| `tools/reference-analysis/evaluation.py`, `tools/reference-analysis/inspect-checkpoint.py` | C++ 평가와 Node 진단·계보 관리; 모델 평가 호출자 | 원본 픽셀 정밀도·재현율, 공변량, 독립성, 체크포인트 거부 |
| `tools/reference-analysis/macro.py`, `tools/reference-analysis/publisher.py` | C++ PDF·영상 계층과 Node 권리·코퍼스 관리; 자료 준비 명령 | 원본·레이어 선택·마스크·출처·기존 결과 보호 |
| `tools/reference-analysis/semap.py`, `tools/reference-analysis/prepare-analysis-images.py` | Node ZIP·출처 소유자와 C++ 영상 계층; 자료 준비 명령 | 범위 다운로드·CRC·SHA, 라벨·이미지 동등성, 취소·실패 |
| `tools/reference-analysis/model.py`, `tools/reference-analysis/train.py` | LibTorch C++ 모델·학습·평가·ONNX와 Node 실행 관리; 학습 명령 | 활성 가중치 추론, augmentation, CPU/CUDA 업데이트와 정확한 재개, ONNX 오차 ≤0.005 |
| `tests/python/test_build_terrain_dem.py`, `tests/python/test_build_terrain_preview.py` | CTest 지형·영상 실제 동작 검사 | 고정 입력의 NoData·LOD·픽셀 및 오류 사례 |
| `tests/python/test_map_plugin_geopdf.py`, `tests/test_map_plugin_raster.py` | CTest와 Node 지도 영상·GeoPDF 검사 | EXIF·PDF·투영 좌표·크기 제한 및 잘못된 입력 |
| `tests/python/test_qgis_bridge.py` | Node/QGIS 실제 연결·왕복 검사 | 인증·편집·롤백·내보내기 및 덮어쓰기 거부 |
| `tests/python/test_reference_analysis_conditions.py`, `tests/reference-analysis/test_model.py` | LibTorch CTest 학습·augmentation 검사 | 고정 입력의 모델·손실·gradient와 augmentation |
| `tests/python/test_reference_analysis_corpus.py`, `tests/python/test_reference_analysis_review.py`, `tests/python/test_reference_analysis_sources.py` | Node/C++ 코퍼스·검토·출처 검사 | 분리·계보·known/ignore·실패·원본 보호 |
| `tests/python/test_reference_analysis_evaluation.py`, `tests/python/test_reference_analysis_inspection.py` | C++ 평가와 Node 진단 검사 | 경계 지표, 공변량·독립성·체크포인트 진단 |
| `tests/python/test_reference_analysis_macro.py`, `tests/python/test_reference_analysis_publisher.py`, `tests/python/test_reference_analysis_semap.py` | Node/C++ 출처별 코퍼스 생성 검사 | PDF 계층·라벨·mask·ZIP과 출처 불일치 |
| `tests/test_hydro_calibration.py`, `tests/test_hydro_connectivity.py`, `tests/test_hydro_tiles.py`, `tests/test_hydronym_spacing.py` | CTest/Node 수계 생성·교정·명칭 검사 | 논리 ID, 연결·바이너리·한국어 이름 및 실패 사례 |
| `tests/test_lsib_boundary_supplement.py` | CTest/Node LSIB 레시피·화면 차이 검사 | 형상·공유 경계·출처·화면 차이의 고정 사례 |

재개 실행 방식: 로컬 컴파일러 비활성 설정을 유지하고 사용자가 선택한 GitHub CI에서 네이티브 도구를 빌드한다. CI 빌드를 시작하는 체크포인트 커밋은 검증 대기로 표시한다. 대상 바이너리의 CI·로컬 검사가 통과하기 전에는 대응 Python을 제거하지 않는다. 자동 push 검사를 반복하지 않고 필요한 네이티브 workflow를 명시적으로 실행한다.

- **QGIS 피처 추가:** 기존 좌표·무손실 속성 변환과 브리지 소유 편집 세션을 재사용해 피처 추가를 연결했다. CLI/MCP 검사 7개와 [Windows CI 40961490026](https://github.com/kimjeon-il/Pando/actions/runs/40961490026)이 통과했고, 소스 일치 바이너리 SHA-256 `3f48a72cd4467dee87f8400c2878a50c47d02a7bb249e1cf3d118c009719ce4f`로 실제 QGIS 한 인스턴스에서 추가·Undo/Redo·롤백, 중첩 정수 `9007199254740993`, 편집 세션 부재·잘못된 좌표·없는 필드·중복 키 거부를 확인했다. 별도 합성 EPSG:3857 레이어에 WGS84 좌표를 추가해 변환과 Undo/Redo·롤백도 확인했다. 시험 원본은 바뀌지 않았고 운영 자료는 수정하지 않았다.

- **QGIS 피처 삭제:** 네이티브 QGIS의 단일 피처 삭제를 브리지 소유 편집 세션과 Undo/Redo·롤백에 연결했다. CLI/MCP 고정 입력 검사 7개와 [Windows CI 40960162516](https://github.com/kimjeon-il/Pando/actions/runs/40960162516)을 통과했고, 소스 일치 바이너리 SHA-256 `7b76777acfe455b361e795502e342c59e09a8accc7bec60051138554284b8013`을 실제 QGIS 한 인스턴스에서 확인했다. 합성 피처 2개에서 세션 없는 삭제와 없는 ID 거부, 삭제·Undo/Redo·롤백과 중첩 출처 보존을 검증했으며 시험 입력 SHA-256 `bec657b708a2dbb377379f78b79d4675d395ca2c0f8d06bb0381b8a7beefb48f`은 그대로였다. 기존 Python 연결은 나머지 기능 전환까지 유지한다.

- 학습 전환 체크포인트: 현재 Python 모델의 BCE·Dice·연결성 손실과 관측되지 않은 채널의 gradient 고정 사례를 C++ LibTorch로 이전했다. MobileNetV3 encoder·overview·position·decoder·7채널 모델의 340개 텐서 이름, Safetensors 로더와 Python이 만든 합성 logits 전체(기준 SHA-256 `ca115f9ebed8308c702b137f10a08129fec30169e9659af47be05c47439dd218`, 최대 오차 0.005 이하)를 [CI 40840912107](https://github.com/kimjeon-il/Pando/actions/runs/40840912107)에서 확인했다. Windows용 LibTorch 2.14 헤더가 C++20을 요구하므로 **선택형 학습 대상에만 C++20을 적용**하고 다른 GIS·앱 대상은 기존 C++17을 유지한다. 비공개 macro-v6 가중치를 optimizer 없는 warm-start로 한 번 추출하고 보존 지도 입력에서 추론 및 제한된 학습·재개를 검증했다. 새 학습 체크포인트의 ONNX 내보내기와 전체 학습 실행 경로는 미완료이며 관련 Python과 원본 모델은 유지한다.
- 실제 보존 지도 PNG(`cc8a18a0…8595ad81`, 1680×1290)에서 만든 첫 타일과 비공개 macro-v6의 기존 Python/Node ONNX WASM 전체 logits를 비교했다. 최대 절대오차는 `0.0002338886260986328`이며 0.005 기준 이내다. 이는 기존 모델의 실행 동등성 기준이며, 새 C++의 실모델 결과나 독립 정확도 승인은 아니다.
- 코퍼스의 원본·보고서 첨부 목록 작성은 `tools/reference-analysis/corpus-inventory.mjs`로 옮기고 Python의 중복 구현을 제거했다. 작은 고정 입력 7개에서 기존 Python과 결과가 일치하며 원본, 보고서 증거, 공식 축소본, 앱용 파생본과 출처 URL을 구분한다. 출력은 기존 파일을 덮어쓰지 않고 취소를 전파한다. 코퍼스 검증·검토 준비·학습은 아직 Python에 남아 있으므로 Python 파일 수는 변하지 않는다.
- 보존 모델을 한 번 Safetensors 가중치로 옮기고 실제 지도 입력의 C++ CPU logits 1,835,008개를 이전 Python과 비교했다. 기본 스레드 수에서는 최대 오차 1.148로 실패했으며, 기존 Python과 같은 2개 스레드에서는 **모든 값이 일치**했다. 추론기에 스레드 수를 명시하고 Windows CUDA runtime 연결을 수정해 재검증 중이다. optimizer 상태는 원본 체크포인트에 없으므로 이전 결과를 정확한 학습 재개로 간주하지 않는다.
- [Windows CI 40843474669](https://github.com/kimjeon-il/Pando/actions/runs/40843474669)의 실행 파일과 기존 CUDA runtime으로 같은 실제 지도·모델을 재검증했다. C++ CPU/Python CPU 및 C++ CUDA/Python CUDA 전체 출력이 각각 완전히 일치했고, C++ CUDA와 기존 ONNX WASM의 최대 절대오차는 `0.00024068355560302734`였다. 이 결과는 기존 모델의 실행 동등성으로만 한정하며 새 모델 정확도나 배포 승인이 아니다.
- [CI 40841964938](https://github.com/kimjeon-il/Pando/actions/runs/40841964938)의 합성 학습 사례에서는 AdamW가 decoder를 갱신하고 동결한 encoder 가중치·통계는 변하지 않았다. 이는 실자료 학습이나 저장 후 정확한 재개 검증이 아니다.
- [CI 40844168183](https://github.com/kimjeon-il/Pando/actions/runs/40844168183)에서 새 C++ 체크포인트가 모델·AdamW·CPU 난수·샘플 순서·동결 및 학습 모드를 복원한 뒤 다음 합성 업데이트까지 정확히 재현했다.
- 실자료 학습 후보 중 CIA 2021 세계지도 한 장만 선택해 기존 코퍼스 검증으로 원본·권리·감독 mask·파생 영상 해시와 source-derived-weak 상태를 확인했다. 코퍼스의 옛 OCR 카탈로그 경로가 현행 소스 배치에서 실패하던 문제는 기존 Node 카탈로그를 읽도록 수정했다. 검증은 학습이나 모델 승인에 해당하지 않는다.
- 이 세계지도에서 선택한 타일 인덱스 8의 실제 입력과 macro-v6 warm-start에서 CPU 및 CUDA 각각 체크포인트 저장·복원 후 다음 업데이트가 정확히 재현됨을 확인했다. 이후 그 실험의 밝기 조정이 이미 정규화된 입력을 잘못 제한했음을 발견하여, 기존 결과는 체크포인트 재개 기계적 검증으로만 남기고 실자료 학습 전처리 검증으로 사용하지 않는다. RGB 공간에서 밝기를 조정한 뒤 다시 정규화하도록 수정하고 새 실험을 진행한다. CUDA의 bilinear 역전파는 결정적 연산을 제공하지 않아, 결정적 모드에서만 동일 CPU 기울기를 사용한다. 정방향·기울기 비교와 Windows/Linux 네이티브 검사는 [Windows CI 40845999659](https://github.com/kimjeon-il/Pando/actions/runs/40845999659), [Linux CI 40845999797](https://github.com/kimjeon-il/Pando/actions/runs/40845999797)에서 통과했다. 이는 전체 augmentation·학습, 독립 정확도 검증 또는 배포 승인이 아니다.
- C++ 모델 모듈과 가중치에서 opset 17 ONNX를 직렬화하는 경로를 추가했다. [Windows CI 40847929302](https://github.com/kimjeon-il/Pando/actions/runs/40847929302)의 소스·실행 파일 해시를 확인하고 합성 모델의 모든 출력과 입력·출력 형상, 덮어쓰기 거부를 확인했다. 같은 빌드에서 비공개 macro-v6 warm-start와 보존 지도 타일을 변환해 C++ CPU logits 1,835,008개를 Node와 Chromium의 ONNX Runtime Web에서 각각 비교했으며 최대 절대오차는 `0.00022995471954345703`이다. 이는 실행 동등성이고 독립 평가·공개 승인이 아니다. 범용 학습 완료 체크포인트 내보내기와 전체 학습 실행기는 여전히 미완료다.
- 밝기 조정을 RGB 공간에서 수행하도록 고친 뒤 같은 CIA 지도 타일에서 CPU·CUDA의 학습 업데이트와 정확한 저장·재개를 다시 확인했다. 이 CUDA 체크포인트에서 직접 생성한 ONNX와 같은 체크포인트의 CUDA 추론 결과 1,835,008개를 Node ONNX Runtime Web에서 비교한 최대 절대오차는 `0.00033092498779296875`다. 학습 결과의 ONNX와 비교용 ONNX는 해시도 일치한다. [Windows CI 40850321615](https://github.com/kimjeon-il/Pando/actions/runs/40850321615), [Linux CI 40850324877](https://github.com/kimjeon-il/Pando/actions/runs/40850324877)에서 밝기·모델·체크포인트 관련 검사를, [Windows CI 40851339101](https://github.com/kimjeon-il/Pando/actions/runs/40851339101), [Linux CI 40851338771](https://github.com/kimjeon-il/Pando/actions/runs/40851338771)에서 ONNX 도구 빌드·거부 검사를 확인했다. 내보내기는 현재 이 검증된 비공개 재개 영수증에 연결되어 있으며 전체 학습 파이프라인과 전체 augmentation 동등성은 아직 미완료다.
- 비학습 ONNX 인터페이스 진단은 [Windows CI 40848847677](https://github.com/kimjeon-il/Pando/actions/runs/40848847677)의 C++ 생성기와 Node/WASM 실행으로 대체했고 `verify-model.py`를 제거했다. [Linux CI 40848847814](https://github.com/kimjeon-il/Pando/actions/runs/40848847814)도 네이티브 빌드와 해당 거부 검사를 통과했다. 이 변경 직후 Git 추적 Python은 **48개(도구 31, 테스트 17)**였고, 이후 동시 작업의 테스트 2개가 통합됐다. 원본 모델·학습 자료는 변경하지 않았고, C++ 학습 전체 전환이나 모델 승인을 뜻하지 않는다.
- QGIS 교환 정규화는 `tools/qgis/normalize.mjs`를 단일 소유자로 사용하고 기존 Python QGIS 내보내기도 그 명령을 호출한다. 좌표·CRS 거부, 중첩 source와 64비트 정수 ID 보존, 기존 출력 덮어쓰기 거부, 실제 편집 Core 가져오기·Undo/Redo와 오류 전파를 관련 Node 및 기존 QGIS 브리지 검사로 확인했다. QGIS 3.44.15에서 합성 도형 2개를 실제로 열고 내보낸 결과 형상과 source는 유지됐으며, QGIS는 입력의 최상위 `feature.id`를 출력의 `properties.id`로 옮겼다. 이 실제 QGIS 출력을 편집기에서 가져와 Undo/Redo 및 재내보내기한 뒤 QGIS에서 2개 형상으로 다시 열었다. Node 정규화는 원본 ID를 임의로 다른 ID 영역에 되돌리지 않으며, 네이티브 QGIS 대체 시 이 경계를 명시적으로 처리해야 한다. Python 플러그인·연결 자체는 네이티브 QGIS 대체 전까지 계속 남아 있으며 Python 잔여 수는 변하지 않는다.
- QGIS 3.44.15 / Qt 5.15.13용 선택형 네이티브 플러그인을 [Windows CI 40858496852](https://github.com/kimjeon-il/Pando/actions/runs/40858496852)에서 빌드했다. 바이너리 SHA-256 `c15f3aea0e058f0f3f8e8558abef365687e1828118b46e70884d22283de5be21`과 소스 일치를 확인하고 별도 시험 프로필의 실제 QGIS에서 인증·잘못된 토큰 거부·혼합 도형 2개 열기·EPSG:4326 내보내기·형상 및 중첩 source 보존·기존 출력 거부를 확인했다. 처음에는 QGIS 레이어 선택 대화상자가 자동 요청을 차단해 직접 레이어를 추가하도록 수정했고, 연결 종료 중 소켓 수명도 보호했다. Node CLI의 전용 프로필 자동 시작 및 기존 프로세스 재사용까지 실제로 확인했다. 기존 MCP 편집·처리 기능의 대체와 Python 플러그인 제거는 미완료이며 이 단계는 Python 파일 수를 줄이지 않는다.
- 별도 Node MCP 서버는 처음에 시작·상태·열기·내보내기·정규화를 연결했다. MCP 프로토콜에서 합성 입력 및 거부 경로를 확인하고 실제 QGIS 3.44.15 세션에 연결해 두 도형의 형상과 중첩 source를 보존한 내보내기를 재확인했다. 기존 MCP의 나머지 편집·처리 동작을 대체하거나 기존 MCP 설정을 변경한 것은 아니다.
- 프로젝트와 레이어 목록 조회를 네이티브 CLI·MCP에 추가했다. [Windows CI 40860174735](https://github.com/kimjeon-il/Pando/actions/runs/40860174735)의 바이너리 SHA-256 `73b9bcb4ccfa7e12d6c33073bb99d521b17be9afeb028e8542f74d1ac6abb24b`과 소스 일치를 확인했으며, 실제 QGIS에서 레이어 ID·형상 수·가시성·페이지 경계 및 MCP 조회와 내보내기를 확인했다. 편집과 처리 기능 및 프로젝트 소유 Python 제거는 여전히 미완료다.
- 벡터 레이어의 필드명·유형·길이·정밀도·숫자 여부와 CRS·형상 종류 조회를 네이티브 CLI·MCP에 추가했다. [Windows CI 40878037997](https://github.com/kimjeon-il/Pando/actions/runs/40878037997)의 소스 일치 플러그인 SHA-256 `29f3631a62c455b6101364de2caa532dae6e16998a493704c742719025d499b9`로 QGIS 3.44.15에서 합성 레이어의 필드와 CRS, 없는 레이어 거부, MCP 조회 및 GeoJSON 왕복을 확인했다. 기존 편집·처리 기능은 전환 중이므로 기존 Python 연결은 유지한다.
- QGIS 피처 ID를 사용한 선택·조회·해제를 CLI·MCP에 추가했다. ID는 QGIS의 별도 FID 영역이며 정밀도 손실을 피하도록 부호 있는 64비트 십진 문자열로 전달한다. [Windows CI 40878646853](https://github.com/kimjeon-il/Pando/actions/runs/40878646853)의 플러그인 SHA-256 `d508ee86261e00ad43b5270950bfedb76baaf8cd4c41fd7c6e0586e0f941e64e`로 실제 QGIS와 MCP에서 선택 및 해제를 확인했고, 잘못된 ID를 받았을 때 기존 선택이 보존되는 것도 확인했다. 조건식 선택·편집·처리 기능은 아직 옮기지 않았다.
- QGIS 조건식 선택도 네이티브 연결로 옮겼다. [Windows CI 40879340415](https://github.com/kimjeon-il/Pando/actions/runs/40879340415)의 플러그인 SHA-256 `bdf15f0faefa0abcd9e627a4f797df3c017f6c5cb511297cf9a4e4864e060979`으로 실제 QGIS와 MCP에서 합성 레이어의 이름 조건 선택을 확인했다. 잘못된 문법 및 없는 필드는 거부하고 기존 선택을 유지했다. 기존 편집·처리 기능과 Python 연결은 아직 유지한다.
- QGIS 텍스트 속성 편집은 브리지가 시작한 편집 세션에서만 수행하도록 추가했다. 기존 QGIS 편집 세션을 인수하지 않으며, 수정은 편집 버퍼에 남고 명시적 커밋만 원본 제공자에 쓴다. [Windows CI 40888238335](https://github.com/kimjeon-il/Pando/actions/runs/40888238335)의 플러그인 SHA-256 `06a153f6e6bddd25523f1678bb9b7720a00d9f33b6f4be4d85477ff13ba9d7af`으로 실제 QGIS와 MCP의 수정·Undo/Redo·롤백 및 중첩 출처 보존을 확인했다. 커밋은 합성 시험 복사본에만 수행하고 시험 원본은 해시가 그대로였다. 다른 속성 형식, 형상 편집, 처리 기능과 Python 연결은 아직 남는다.
- QGIS의 EPSG:4326 형상 편집을 편집 세션에 추가했다. [Windows CI 40889196910](https://github.com/kimjeon-il/Pando/actions/runs/40889196910)의 플러그인 SHA-256 `0a391f87d3d1ff36177adf59331d019cfb77e94da0ced6a58a2d9398300ded36`을 실제 QGIS와 MCP에서 실행해 합성 선형 변경·Undo/Redo·롤백, 다른 형상 종류 및 범위를 벗어난 좌표 거부, 중첩 출처·시험 원본 보존을 확인했다. 현재 지원은 기존 피처와 같은 종류의 유효한 2차원 WKT이며 투영 좌표계 편집과 나머지 편집·처리는 미완료다.
- EPSG:4326 WKT 입력을 투영 레이어 CRS로 변환하는 경로를 추가했다. [Windows CI 40890317450](https://github.com/kimjeon-il/Pando/actions/runs/40890317450)의 플러그인 SHA-256 `8a2b19423cf8fd42092b7d8bebac2e8699d237d2db3f81876b631c580ded90bd`로 합성 EPSG:3857 GeoPackage의 편집·WGS84 재내보내기 및 Undo를 실제 QGIS와 MCP에서 확인했다. UTM 투영 범위를 벗어나 실패하는 좌표는 예외를 응답으로 전달하고 QGIS를 유지했으며 롤백했다. 대체 변환은 허용하지 않는다. 이는 선택한 합성 사례의 좌표 변환 확인이며 모든 데이터나 좌표계의 검증이 아니다.
- 기존 텍스트 전용 편집을 무손실 JSON 속성 편집으로 대체하고 공통 C++ JSON 정본을 재사용했다. [Windows CI 40891590832](https://github.com/kimjeon-il/Pando/actions/runs/40891590832)의 플러그인 SHA-256 `6337a63749124906aa98cd077c6f9636a8fbdc60b45ad2cd323e425f6c271c7f`으로 실제 QGIS와 MCP에서 문자열·불리언·정수·중첩 출처, 64비트 정수 `9223372036854775807`, Undo/Redo·롤백을 확인했다. 정수 필드 범위 초과, 소수의 정수 변환, 중복 JSON 키와 형식 불일치는 거부하고 시험 원본을 보존했다. QGIS 기능과 Python 전체 전환은 아직 미완료다.
- QGIS 피처를 필터와 페이지 크기를 제한해 조회하고, FID와 중첩 속성의 큰 정수를 손실 없이 반환하는 경로를 추가했다. [Windows CI 40892664676](https://github.com/kimjeon-il/Pando/actions/runs/40892664676)의 플러그인 SHA-256 `5213ac267ada108e0bf849539f9fbef2b9ed5413b283685f839555729a9dfc1e`로 실제 QGIS와 MCP에서 2개 합성 피처의 페이지 이동·이름 필터·선택적 WKT·정수 `9007199254740993` 및 중첩 출처를 확인했다. 필터된 전체 개수를 계산하기 위해 전체 레이어를 순회하지 않으며 다음 페이지 여부를 반환한다.
- 동시 작업 통합 커밋 `fa0b3734`가 기존 55개 목록 밖의 테스트 `tests/python/test_map_plugin_geopdf.py`와 `tests/python/test_reference_analysis_review.py`를 추가했다. 이 추가는 Python 수를 늘리지 않는 계획과 충돌하며, 통합 직후 Git 추적 수는 **50개(도구 31, 테스트 19)**였다. 두 테스트는 각각 지도 영상/GeoPDF 전환과 코퍼스 검토 전환에 포함해 실제 동작 검사를 옮긴 후 제거한다. 기존 55개 목록은 보존하고 이 두 경로만 명시적으로 추가 검토한다. 다른 Python 경로 추가는 허용하지 않는다.
- **독립 수계 지점 감사 전환:** 출처와 판정·결과 관리는 Node `verify-independent-river-point-anchors.mjs`, UTM 변환과 선형 최근접점은 선택형 C++ GEOS/PROJ 도구가 담당한다. 기존 Python 결과와 [Linux CI 40861419219](https://github.com/kimjeon-il/Pando/actions/runs/40861419219)의 고정 사례 및 실제 5개 수계 결과가 완전히 일치했고, [Windows CI 40861767205](https://github.com/kimjeon-il/Pando/actions/runs/40861767205)의 소스 일치 바이너리 SHA-256 `66b9f56d06a5938cafb93a876770839d70a414d363037057316513193e38f7dc`를 기존 OSGeo4W GEOS 3.15.0·PROJ 9.8.1로 실행해 같은 결과를 확인했다. 실제 입력은 자료 판본 `0bce2891d531579b81ac0f97e6d07cb1873b878f`의 Hydro 묶음 SHA-256 `f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f`; 생산 디코더가 16,548개 피처를 읽고 5개 수계만 비교했다. Python 기준 결과를 SHA-256 `41a7282829f3cf40764d5b9c87c8abdc9b77a81e2e1c56de2a0e23c92442c36b`의 작은 테스트 fixture로 고정하고 실행·Actions·검사를 전환해 `verify_independent_river_point_anchors.py`를 제거했다. 지점 근접도는 수계 명칭이나 전체 형상 승인에 해당하지 않는다.
- **첫 10개 수계 지점 감사 전환:** 기존 Python의 원본 결과와 [Linux CI 40873308447](https://github.com/kimjeon-il/Pando/actions/runs/40873308447)의 Node/C++ 결과 및 Windows 소스 일치 실행 결과가 10개 수계·99개 지점 전체에서 일치했다. 입력은 위와 같은 Hydro 묶음이며, 기존 Python 결과 54,180바이트의 SHA-256은 `b1ede3b3aa1510811f7fb22d2b9cbb80c277ef221fda532e4e75c823259f3879`다. 이 결과를 고정 fixture로 보존하고 출처·판정 관리는 Node, UTM 및 최근접점은 같은 C++ 도구의 분리 선분 모드로 전환해 `verify_osm_hydro_batch01_anchors.py`를 제거했다. 런타임 지형과 수계 명칭은 수정하지 않는다.
- **두 번째 10개 수계 지점 감사 전환:** [Linux CI 40874172847](https://github.com/kimjeon-il/Pando/actions/runs/40874172847)과 [Windows CI 40874173643](https://github.com/kimjeon-il/Pando/actions/runs/40874173643)의 소스 일치 C++ 도구 및 Node 관리 계층으로 같은 Hydro 원본의 결과를 Python과 비교했다. 외부 지점이 없는 경우 18개, 합성 관측소·NGA 입력을 넣은 경우 20개 지점이 각각 일치했다. 고정 기준 결과 SHA-256은 각각 `6e19f629c3645ddc80b7c988f5e1f62b416f65d77eca2394a000a35e89c50f2e`, `f71f7f4f7ecc0e1dda048d371a76ce8eea6cd8d69c6d116a15ba8a0188eb4d64`다. 외부 자료 출처가 불일치하거나 명시한 파일이 없으면 이제 명시적으로 실패한다. 합성 선택 입력 검사는 실측 원본 전체를 검증한 것이 아니며, 기존 실자료 수집 워크플로는 유지한다. `verify_osm_hydro_batch02_points.py`와 그 호출을 제거했다.
- **마지막 11개 수계 지점 감사 전환:** [Linux CI 40875338744](https://github.com/kimjeon-il/Pando/actions/runs/40875338744)와 [Windows CI 40875338662](https://github.com/kimjeon-il/Pando/actions/runs/40875338662)의 소스 일치 도구로 고정 NGA 응답 13개와 실제 Hydro 11개 수계·6개 지점의 기존 Python 결과를 대조했다. 기준 결과 27,235바이트의 SHA-256은 `bc7046113a83ed71e98e369bec9e8dca36739bd51e2a90f252a603154cd82711`이다. 네트워크 미확인 시 이름 부재로 판단하지 않고, 실패 유형은 실제 Node 오류 이름으로 기록한다. 이 비교는 실제 NGA 서비스 현재 상태의 확인이나 지명 승인에 해당하지 않는다. 조회·출처 관리는 기존 Node NGA 소유자로 통합하고 최근접 선분 선택은 C++ GEOS 공간 인덱스로 전환해 `verify_osm_hydro_batch03_points.py`를 제거했다. 당시 Git 추적 Python은 46개였다.
- **빅토리아 Yarra 정부 수계 벡터 감사 전환:** 정부 원본 1,312,391바이트의 SHA-256 `70a2b0c84e9094258c64514d1392f7ef712fbaa7312754a7b80296e3dbb50fb6`이 기존 보고서의 출처와 일치한다. Hydro 41개 선분과 정부 원본 4개 선분을 양방향으로 각각 161회 표본 검사한 Python 기준과 [Linux CI 40876784343](https://github.com/kimjeon-il/Pando/actions/runs/40876784343), [Windows CI 40876784315](https://github.com/kimjeon-il/Pando/actions/runs/40876784315)의 C++ 도구 결과 및 기존 보관 보고서의 측정값이 일치했다. 기존 Python 결과 SHA-256 `500406a9024c029e27acf43e10eb48f4871675e6ebd9beb90abf0f8531749df1`을 테스트 기준으로 고정하고 원본 검증과 실행 관리는 Node, 투영 및 거리 계산은 C++로 전환했다. Python 제거 후 고정 기준 비교 [CI 40877589885](https://github.com/kimjeon-il/Pando/actions/runs/40877589885)와 실제 공식 감사 [CI 40877758851](https://github.com/kimjeon-il/Pando/actions/runs/40877758851)이 통과했다. 정부 원본은 최종 증거 보관 전까지 보존한다. `verify_victorian_yarra_source.py`를 제거한 뒤 추적 Python은 **45개(도구 26, 테스트 19)**, 기존 목록 상한 43·전체 상한 45다.

- 독일 1914 생성기: 기존 GEOS/PROJ 엔진에 WGS84 타원체 면적과 헬골란트 패치 검증을 추가하고 Node 자료·출력 관리자를 연결했다. [CI 40838951664](https://github.com/kimjeon-il/Pando/actions/runs/40838951664)에서 26개 합성 주와 실제 Natural Earth 헬골란트 원본을 각각 사용해 Python/C++ 출력 형상·면적·검증값을 대조했다. 이 두 기준을 고정 fixture로 남기고 Python 생성기와 oracle 실행을 제거했다. 사용자 예외에 따라 Harvard HGIS 원본 26개 기반 실자료 재현과 역사 형상은 **미검증**으로 유지한다. 현재 추적 Python은 **49개(도구 32, 테스트 17)**다.

- Windows 파일 할당량: `tools/pc-file-allocation.py`를 선택형 C++ 대상 `pando-pc-file-allocation`으로 전환했다. [Windows CI 40833720677](https://github.com/kimjeon-il/Pando/actions/runs/40833720677)의 바이너리를 고정 `build-native/pc-allocation`에 받아 소스·실행 파일 SHA-256을 검증한 뒤 기존 Node 정리 소유자가 호출한다. CI와 로컬에서 하드링크·긴 한글 경로·정션 차단을 확인하고, 로컬에서 희소·압축 파일의 실제 할당량과 Python 결과 동등성을 확인했다. 최종 실행 경로에 Python·자동 컴파일·fallback을 남기지 않았다. 잔여 추적 Python은 **50개(도구 33, 테스트 17)**이다. 이 검사는 사용자 파일 정리 실행을 뜻하지 않는다.

사용자가 승인한 55개 기준이다. Git 추적 파일 수를 현재 진행률로 계산한다. 아래 목록은 최초 기준으로 보존하며 새 Python 파일을 허용하지 않는다. 기능별 대체·실제 호출자·검증·삭제 조건은 아래의 각 그룹을 따른다. 55개 각각의 호출자·대응 검사 상세 연결은 계속 작성해야 한다. 원본 26개가 없는 HGIS 실자료 비교는 미검증으로 남긴다.

- 지도 원본 수집: `map_source.py`와 `acquire-sources.py`를 `plugins/pando-map-tools/lib/map-source.mjs`와 `tools/reference-analysis/acquire-sources.mjs`로 이전했다. 지도 분석 CLI와 코퍼스 CLI가 같은 수집 정본을 사용한다. 네 형식 고정 입력의 원본 바이트·크기·SHA-256을 이전 구현과 비교했고, 권리·HTTPS·제한·체크섬·취소·동시 생성 보존은 Node 검사로 확인했다. 기존 파생 이미지 Python 테스트는 유지한다.
- 비공개 패키지 ZIP: 패키징과 cloud probe의 ZIP 생성에 쓰던 인라인 Python을 스트리밍 Node ZIP 작성기로 교체했다. 원본 파일·기존 ZIP 보존, CRC/내용 확인과 진단 실행에 필요한 의존성 포함을 별도로 검사한다. 파일 목록 53개에는 변화가 없다.
- Hydro 이름 재포장: 기존 Python 생성기를 Node로 이전했다. 고정 자료와 운영 자료의 10047863 수계 1개(원본 번들 SHA-256 `f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f`)를 Python과 비교해 메타데이터 의미·색인·형상 바이트가 일치했다. 압축 결과의 전체 해시는 Node `c140969f68579d52d5d72123f71e576d32e07029b2aba22d3040f1de31220e28`, Python `f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f`로 달랐으며 운영 manifest와 자료 pin은 갱신하지 않았다.
- Hydro/Natural Earth 조사: 기존 Node 조사기와 Python 원본을 현행 Hydro OSM 잔여 31개 및 검토 수계 42개에 비교했다. Natural Earth 원본 SHA-256 `3391aa917d3707be8da0a133b5a3bde26594e8b87648cb7f533d0df4fd8bcc99`의 명명 선분 4,226개, 수계 ID·본류 형상 범위·후보·지지 샘플이 일치했고 평균 거리는 기존 CI 허용오차 0.00002도 이내였다. Python 조사기는 제거하고 CI 두 호출을 Node 정본으로 전환한다. 자동 후보는 지명 승인으로 취급하지 않는다.
- Hydro 조사 증거 대조: CI의 USGS 관측점, Natural Earth 검토 후보와 Yarra 벡터 결과를 비교하는 세 인라인 Python을 Node 정책 모듈로 전환했다. 실제 USGS 2개 수계 및 Natural Earth 42개 수계 대조와 실패 사례를 확인했다. Yarra 벡터는 고정 사례만 검사했으며 이번에 정부 API 실자료 대조를 재실행하지 않았다.
- 저장소 보고서 소유권 검사: CI에서 Git 추적 경로를 확인하던 인라인 Python을 Node 검사로 전환하고 현재 추적 경로에 대해 실행했다. GIS 생성기 구문 검사에는 아직 Python이 필요하다.
- Hydro 3차 조사 기록: 11개 수계 조사 결과의 범위·비승인 상태 검사와 관측점 25개 단위 영수증 출력을 Node 정책 모듈로 옮겼다. 점간 GIS 계산 Python과 정부 API 실자료 조사는 후속 전환 대상이다.
- Hydro 1·2차 조사 결과의 수계 범위와 원본 무변경 검사도 인라인 Node로 옮겼다. 양쪽 CI 검사의 정상·변경된 영수증 처리만 별도로 확인했으며 원본 수집·GIS 계산 Python은 그대로 남아 있다.
- 핀란드 NLS 수계 서비스 조회: Python 인라인 조회를 크기·시간 제한이 있는 Node 조회기로 교체했다. 실제 서비스에서 4개 샘플의 속성 이름만 확인했으며 원본 형상은 저장하거나 런타임에 반영하지 않았다. 조회 성공은 지명·수계 승인 근거가 아니다.
- NGA GNS와 중앙아시아 관측소 수집: 2차 연구 CI의 인라인 Python 두 블록을 Node 정본으로 연결했다. HTTPS·응답 크기·시간·취소 제한과 MD5 확인, 관측소/하천 명칭 구분, 읽기 전용 SQLite 추출을 유지한다. 고정 사례 8개와 YAML·lint를 확인했다. 실제 GNS 요청은 4개 중 2개가 응답했고 중앙아시아 원본 요청은 시간초과/접근실패로 실자료 추출이 미검증이다. 실패는 자료 부재로 판단하지 않는다. 공간 비교 Python은 아직 유지하며 이 변경은 추적 Python 50개를 감소시키지 않는다.
- 지도 플러그인 경로 복구: 실행·OCR·소스 패키징의 옛 `assets/js`·`assets/wasm` 참조를 현행 `shared/frontend` 소스 배치로 교체했다. 기존 UI Python 런타임을 재사용해 플러그인·패키지 검사와 CLI의 미검증 출처 보류 경로를 확인했다. 실제 보존 지도 PNG(5,161,936 bytes, SHA-256 `cc8a18a0e80370929d5572935adefa5baffec902344278bf08ef21145895ad81`)와 비공개 기존 모델로 OCR·경계 후보·미리보기를 실행해 `needs-georeference` 결과를 확인했다. 영상 처리의 C++ 전환과 지도 승인·모델 정확도 검증은 미완료다.

- `plugins/pando-map-tools/lib/map_source.py`
- `plugins/pando-map-tools/lib/raster.py`
- `tests/python/test_build_terrain_dem.py`
- `tests/python/test_build_terrain_preview.py`
- `tests/python/test_qgis_bridge.py`
- `tests/python/test_reference_analysis_conditions.py`
- `tests/python/test_reference_analysis_corpus.py`
- `tests/python/test_reference_analysis_evaluation.py`
- `tests/python/test_reference_analysis_macro.py`
- `tests/python/test_reference_analysis_publisher.py`
- `tests/python/test_reference_analysis_semap.py`
- `tests/python/test_reference_analysis_sources.py`
- `tests/reference-analysis/test_model.py`
- `tests/test_hydro_calibration.py`
- `tests/test_hydro_connectivity.py`
- `tests/test_hydro_tiles.py`
- `tests/test_hydronym_spacing.py`
- `tests/test_lsib_boundary_supplement.py`
- `tests/test_map_plugin_raster.py`
- `tools/build-hydro-tiles.py`
- `tools/build-physical-data.py`
- `tools/build-terrain-dem.py`
- `tools/build-terrain-preview.py`
- `tools/build_german_empire_1914_base.py`
- `tools/build_german_empire_1914_modern_coast.py`
- `tools/calibrate-hydro.py`
- `tools/gis/compare_osm_hydro_natural_earth.py`
- `tools/gis/prepare_hydro_name_replacement_bundle.py`
- `tools/gis/verify_independent_river_point_anchors.py`
- `tools/gis/verify_osm_hydro_batch01_anchors.py`
- `tools/gis/verify_osm_hydro_batch02_points.py`
- `tools/gis/verify_osm_hydro_batch03_points.py`
- `tools/gis/verify_victorian_yarra_source.py`
- `tools/hydro_connectivity.py`
- `tools/library_data.py`
- `tools/pc-file-allocation.py`
- `tools/qgis/bootstrap.py`
- `tools/qgis/bridge.py`
- `tools/reference-analysis/acquire-sources.py`
- `tools/reference-analysis/corpus.py`
- `tools/reference-analysis/evaluation.py`
- `tools/reference-analysis/inspect-checkpoint.py`
- `tools/reference-analysis/macro.py`
- `tools/reference-analysis/model.py`
- `tools/reference-analysis/prepare-analysis-images.py`
- `tools/reference-analysis/publisher.py`
- `tools/reference-analysis/semap.py`
- `tools/reference-analysis/train.py`
- `tools/reference-analysis/verify-model.py`
- `tools/repair-hydro-connectivity.py`
- `tools/report_paths.py`
- `tools/supplement-lsib-boundaries.py`
- `tools/verify-hydro-connectivity.py`
- `tools/verify-lsib-screen-delta.py`
- `tools/verify-terrain-dem.py`

## 실행 현황 — A0~A2 (2026-10-25)

- **C2 북슐레스비히 과잉 정밀조사 종료 (2026-10-27, 최신 지시):** Natural Earth 1:10M 표시 축척 대비 불필요했던 북슐레스비히 표석 1~26·SLUB 도엽 4장·교구 경계 중첩·지도 보관 및 권리 검증을 **사업 범위에서 철회**한다. 12개 연구 Python과 대응하는 전용 Node·Actions·테스트를 기능 전환 대신 삭제한다. 기존 보고서의 '삭제 전 원도엽 영구 보존 의무'는 사용자 승인으로 철회되었다. **운영 역사 객체 `state:north-schleswig`, `north-schleswig-1900-r3`, 국가별 색인과 일반 지도 입력·출처 표시는 보존한다.** 외부 라이브러리의 별도 연구 사료는 런타임 핀 이력과 분리해 정리하며, 핀을 무단 전진시키거나 운영 형상을 바꾸지 않는다.


- **C2 SLUB 원도엽 영구보존 재검증 (2026-10-27):** [Actions #40342241974](https://github.com/kimjeon-il/Pando/actions/runs/40342241974) 임시 ZIP (아티팩트 12659318765, 만료 2026-11-09, ZIP SHA-256 `d419c5ec1cc2d9d361495b379623bdf31b9c360e5421e81404db6376804ecfe8`)의 **10개 실제 파일을 다운로드해 내부 4개 PNG(1600×1200), 4개 SVG, 영수증 2개를 별도로 열어 검증**했다. 4개 PNG SHA는 `CAPTURED_WMS_VIEWS` 고정 영수증과 일치. 현행 자료 핀 `dd7ba67d5a35796593bf60d6007f192c8bca7964`의 보관 색인에서 해당 도엽 영상/고해상도 원본은 **0개**이다. SLUB는 객체별 PDM·CC BY-SA 4.0·권리유보 정책을 구분하고, 과거 지도 WMS 메타데이터는 1900년 이전 CC BY-SA 4.0이라고 설명하지만 **현재 4개 객체 각각의 이용허락을 확인하지 못했다.** 따라서 고해상도 원본 보존·영구 수장·개별 권리·1914 국경 정확도는 모두 미완료이다. 기존 연구 후보를 원도엽으로 둔갑시키거나 데이터 원본을 변경하지 않는다. 임시 영수증의 `completePrivateResearchSnapshot` 4/4 판정 버그를 수정하고, **0/4 지도 수집을 CI 성공으로 오인하지 않도록** 강화했다. 이미지 원본 공개·Python 조사 코드 삭제는 별도 검증 이후에만 실시한다.


- **C2 미사용 OSM 북슐레스비히 1864 서부 조사 종료 (2026-10-27):** `fetch_north_schleswig_1864_west_sources.py` 및 `fetch-north-schleswig-1864-west.yml`의 출력 5종(graensestien 원본·route 후보, Overpass 노드·marker 후보·요약)은 지정 경로에서 읽는 현행 소비자가 없으며, 고정 자료 revision `a963457e578d335fec181f91ad25dfe729e96e1b`의 `archive/index.json`에도 등록되지 않았다. 실제 19세기 원도엽이 아니라 OSM 관계/Overpass 후보를 다시 가져오는 실행 경로이므로 신규 Node 수집기로 이식하지 않고 종료한다. 이미 보존된 별도 1914 국경 GeoJSON·보고서·출처 자료와 기존 4개 SLUB 도엽 보존 작업은 수정하지 않는다. 후자는 별도 권리·원본 바이트 확인 완료 전 삭제 금지.


- **C1 LSIB 원본/세계 국경 무변경 감사 Node+C++ 전환 (2026-10-27):** `verify-lsib-country-sources.py`의 git 원본 lineage/국가 ID/명칭/기간/과거 geometryVersion 보존 검사 및 검증 영수증을 `tools/gis/verify-lsib-country-sources.mjs`로 이관. GEOS 변경된 현대 다각형 유효성 및 세계 모든 폴리곤의 방향 무관 이진64 선분 홀짝 집계는 `--audit-lsib-modern-sources`에 집중. Node·네이티브 synthetic 정상·실패 회귀검사와 역사 GIS CI 경로를 추가하고 Python 검사기를 제거. 원본 국가 지오메트리/LSIB 자료 및 브라우저 지도를 건드리지 않음. **외부 라이브러리 실제 source-baseline 재현 검증은 별도 미완료**이며, 이 항목은 검증도구 이전이지 국경선 보정 승인이나 `supplement-lsib-boundaries.py` 전체 대체가 아님.


- **A0:** `work/gis`에 `gis-node-migration.yml`을 추가하고 기존 Node 생성기 3종 회귀 테스트 실행 통과 ([Actions 40170378584](https://github.com/kimjeon-il/Pando/actions/runs/40170378584)).
- **A1:** `build-place-candidates.py`를 Node 정책·ZIP streaming/CRC·review/감사 모듈로 이전하고 Python 테스트를 Node 24개 테스트로 대체. `fetch/build/review` 명령, dry-run와 source checksum, ID별 evidence, 현대 데이터의 역사적 도시 승인 금지를 검증 ([Actions 40171323978](https://github.com/kimjeon-il/Pando/actions/runs/40171323978)).
- **A2 1차:** Node GIS launcher, reportArgument, 브라우저 캡처 trace 분석, 폰트·함수 소스 단위 테스트로 Python CLI/테스트 6개 교체. [Actions 40171812270](https://github.com/kimjeon-il/Pando/actions/runs/40171812270) 통과.
- **A2 잔여 정리 2차:** `tests/test_v0306_layer_lock_sync.py`의 잠금 검색 동기화 검사를 `tests/unit/layer-lock-sync.test.mjs`로 이관하고 Python 원본을 삭제. `tests/test_hydro_tiles.py`는 JS 환경값 파일을 직접 읽도록 바꿔 `tests.application_source`에 의존하지 않음. 반복된 Node 워크플로 경로 항목도 정리. 이후 C1 역사 데이터 계약을 Node로 이전하면서 마지막 호출자인 `tests/test_v0280_historical_library.py`와 `tests/application_source.py`를 함께 제거했다.
- **A2 정적 보호 게이트:** `tests/unit/python-bridge-retirement.test.mjs`는 최초 101개 Python 파일 전수 목록을 고정하여 미심사 Python 파일 추가 및 남은 개수 증가를 거부한다. `library_data.py`·`report_paths.py`·`application_source.py`는 실제 Python 호출자가 존재할 때만 허용하며, 마지막 호출자가 사라졌는데도 남는 경우 실패시킨다. 이 검사는 CI 및 `test:gis-node`에 포함한다.
- **B1 1차:** `inventory-osm-hydronyms.py`의 검증된 Hydro v0.13.2 읽기 전용 OSM 참조 감사와 FID·압축 세그먼트 SHA·명칭 계보 출력 계약을 `inventory-osm-hydronyms.mjs` 및 Node 테스트로 교체. OSM과 연결된 객체가 곧 OSM에서 이름을 가져왔음을 의미하지 않는 기존 제약을 보존. 전용 GIS Actions의 실행 명령을 Node로 전환하고 Python 원본을 제거. 기존 배포 지도·출처 바이트는 변경하지 않음.
- **B2 C++ 1차:** Python `hydro_connectivity.py`의 NEXT_DOWN 기반 합류점 보정 규칙을 독립 `tools/cpp/hydro/connectivity-junctions.cpp`에 C++17로 이식하고 단위 회귀 검증을 추가했다. 양자화 1e-6°, 다수 지류·split reach, aligned border anchor, 원본 접속 0.5m와 표시 접속 25km 한계를 검증한다. Python 생성기·자료/manifest와 WASM은 아직 변경하지 않았다. 네이티브 도구의 검증된 통합과 원본 대조 전까지 기존 Python 원본은 유지한 뒤 B2 완료 시 삭제한다.
- **B1 명칭 정책 2차:** 독립 HydroRIVERS 명칭 승인 42개 검토 원장, OSM 거절·USGS·Natural Earth·정부 벡터·국경 간 출처 판정 규칙을 Node 단일 정책으로 이관. 기존 생성기/메타데이터 재패킹에서 임시 Node CLI 호출을 통해 검증하며 Python 정책 모듈/테스트 원본은 제거. 배포 데이터/원본 바이트는 수정하지 않음.
- **B2 실제 생성 경로 연결:** Python `build-hydro-tiles.py`와 `repair-hydro-connectivity.py`의 합류점 보정이 `PANDO_HYDRO_CONNECTIVITY_BINARY`로 독립 C++ GIS 실행기를 필수 호출한다. `hydro_connectivity.py`의 과거 계산은 고정 비교 oracle로만 사용하며 자동 폴백을 금지한다. 반환된 포트 변경과 변경 영수증을 전수 대조한 후 메모리 안의 좌표만 갱신한다. 고정 10종 접속 사례에 대해 Python·C++ 결과 동등성을 검증한다. **전 세계 HydroRIVERS 원본 전수 재생성/바이트 해시 비교는 아직 미완료**.
- **B1 USGS 출처 감사 3차:** 정부 USGS 관측점 6곳의 수계 중심선 거리 측정을 Node로 옮기고 Python 코드를 제거했다. 고정 synthetic 테스트와 현재 게시된 v0.13.2에서 확보한 과거 Python 거리 oracle의 수치 12개를 별도로 검증한다. 기존 OSM 대응 73개와 독립 이름 검토 42개는 검증 목적이 달라 별도 후보셋으로 대조하여 KeyError(10047863)를 없애되 승인 조건을 낮추지 않는다.
- **B1 명칭 원장 생성 4차:** 배포 Hydro의 검증된 metadata·source sha256·FID·수계명 분류, 연장·면적, 별도 CSV/압축 보고서 출력을 Node로 전환. 기존 Python `inventory-hydro-names.py`와 회귀 테스트를 삭제하고 원본 자료 변경 없이 외부 staging에서만 실행. 대규모 실데이터 보고서의 바이트 동일성은 아직 미검증이며 샘플 의미 검증만 완료할 수 있다.
- **B1 실데이터 재현 보정:** 수계 42개가 일부 승인된 현재 한국어 이름을 이미 가진 경우에도, 원본 이름 또는 승인 이름만 허용해 재패킹/독립 출처 제거를 진행한다. 제3의 이름은 여전히 실패 처리하며 바이너리 형상·인덱스 비트 동일성 검사는 수정하지 않는다. 이 작업은 보고서용 외부 staging 재현이며 런타임 재배포나 자료 원본 덮어쓰기가 아니다.
- **B1 Natural Earth 선형 후보 이관 준비:** Shapely 코드의 총 81개 선형 표본점/이름별 근접 최대 0.14°/후보 순위 연산을 Node에 독립 이식하고 synthetic 테스트를 추가. 현재 GIS Actions에서 기존 Python과 실데이터 73개 차분검사를 먼저 수행한다. 수치 동등성 확인 전에는 Python 원본을 지우거나 출처 승인 판정을 바꾸지 않는다.
- **B1 배포본 재현 정정:** 자료 핀 `1879138`의 Hydro v0.13.2에는 독립 근거 42개가 이미 반영되어 있고 OSM 연결은 31개만 잔존한다. 중복 42개 재생성은 음수 OSM 지역 집계를 발생시키므로 전용 GIS 감사에서 제거했다. 대신 Node 읽기 전용 검사가 원본 전체 Hydro SHA, segment/index/shard 바이트 해시와 순서, 42개 승인 수계·1895개 세부 형상·독립 URL·31개 잔여 OSM 지역 집계를 전수 확인한다. 원본이 다시 생성된 것으로 주장하지 않는다.
- **B1 Natural Earth 20532766 정확도 수정:** 게시 원본 SHA `f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f`에서 본류 3개 단편, 메타데이터 경계 원시 위도 43.243750°를 확인. Python `round(int_micro / 1e6, 4)`은 이 binary64 값에서 43.2437°를 반환하지만 기존 Node의 정수 반올림은 43.2438°를 반환하여 지오메트리 메타데이터 동등성 검사가 실패했다. Node에서 IEEE-754 비트 기반 정확한 ties-to-even 소수점 반올림을 구현해 수정했다. 정확한 원본 바이트 검증 후 [경량 원본 진단 40184808535](https://github.com/kimjeon-il/Pando/actions/runs/40184808535) 및 [31개 실제 수계/4,226개 NE 명칭 선형 Python·Node 전체 비교 40184932244](https://github.com/kimjeon-il/Pando/actions/runs/40184932244)가 모두 통과했다. 배포 지오메트리·표시 좌표·바이너리·명칭 승인 정책은 변경하지 않았다. 비교용 임시 Actions 워크플로는 후속 커밋에서 제거한다.
- **C2 HGIS 수집 이전:** 독일 1914 HGIS 26개 상태 다각형 원본 수집을 Node.js로 이전, 원본 좌표/이름·EPSG:4326 보존, 기존 파일은 byte-for-byte 동일할 때만 재사용. 수정된 원본은 절대 자동 덮어쓰지 않고 Harvard/NYU 비상업적 이용 조건을 유지. Python 수집기 삭제, Node synthetic fixtures 및 CLI 검증 추가. 별도 C++ 영토 재구성은 아직 미완료.
- **C2 조약 좌표 이전:** `baikonur_official_reference.py` 및 Python 테스트를 Node로 이전. 카자흐스탄 조약 기준점 31개·유효 직선 29개·Syr Darya 우안 미복원 구간 2개 및 법적 경계 미확정 상태를 유지. 연구 원본은 새 파일로만 출력하며 OSM 자료 미사용 정책을 보존.
- **C1 GEOS/PROJ 레시피 확장:** 기존 `pando-territorial-recipe`에 경도·위도 별도 선형 좌표보정, 정확한 bbox 폴리곤, 겹침 면적을 기준으로 원본 섬 전체 선택 및 선택 구성요소 수·필수 포함 지점 검증을 추가. 기존 `german-empire-1914-base.recipe.json`에 HGIS 26개 주→축 보정→현대 독일 헬골란트 2개 섬 선택→교정창 제거→섬 합성 C++ 연산을 선언. 원본 HGIS 해시·기존 Python 결과 전수 동등성 검증 전에는 결과를 승인하지 않고 Python 생성기도 삭제하지 않음.
- **C2 북슐레스비히 일회성 조사 정리 보존 게이트:** 고정 라이브러리 자료 revision `1879138b54b2c9f8c173bf5575b108e3f1f8139b`의 `archive/index.json`을 실제로 검사한 [GIS preservation inventory CI #40190061508](https://github.com/kimjeon-il/Pando/actions/runs/40190061508) 성공. `north-schleswig` 논리 경로별 **역사 지도/중첩 이미지 0개, 공간자료 11개, 보고서 7개, 출처·검증 메타데이터 23개**가 등록되어 있다. 인덱스에 있는 것은 저장 원본의 전수 SHA 검증이나 재배포권 확인을 의미하지 않는다. 일부 기존 조사 보고서는 원본 지도·중첩 이미지가 7일짜리 Actions 임시 아티팩트였으며 영구 저장하지 않았다고 명시했다. 따라서 역사 지도 원본과 필요한 시각화 증거, 저작권·시기·위상 및 원본 SHA 확인 전에는 북슐레스비히 일회성 Python 스크립트/Actions를 삭제하지 않는다. 해당 조건이 충족된 뒤 C2 원본 수집은 Node, 남겨둘 공통 좌표·위상 검증은 GEOS/PROJ C++로 전환하고 중복 조사 코드를 제거한다.
- **C2 동독 원본 수집 Node 전환:** `fetch-east-germany-sources.py` 전체 `full/vg25/vg25-captured` 수집 범위를 `fetch-east-germany-sources.mjs`로 이전한다. Natural Earth 6개 주, Amt Neuhaus·Berlin Land 단일 BKG feature, 베를린 장벽 두 WFS 레이어와 CRS·AGS·정렬·출처 SHA, 동독 VG25 기준 5개 주·현대 LSIB 정본 조립을 독립 fixture로 검증한다. 기본은 읽기 전용 후보 검토, 명시적 `--execute`는 비어 있는 출력 파일만 생성하며 승인된 기존 원본은 절대 덮어쓰지 않는다. 최신 BKG 관측을 역사 경계로 자동 확정하지 않으며 라이브러리 원본/데이터 핀/WASM은 변경하지 않는다.
- **C2 SLUB 독립 지도 출처 목록 Node 전환:** `discover_north_schleswig_1914_map_services.py`를 Node로 이관하고 Python 원본을 제거한다. 4개 도엽의 공간검색, 1860~1914 역사 판본 날짜 범위, 출처 URL·검색 실패, Unicode 이름 정규화와 메타데이터 보호 규칙을 유지한다. 기존 자동 자료 변경/푸시 Actions는 읽기 전용 SLUB 목록 검사와 임시 출력 증거로 교체한다. 수집·비교된 역사 래스터는 여전히 0이며 국경선 좌표를 승인하지 않는다.
- **C1/C2 최신 자료 핀 실측 (2026-10-26):** 승인한 외부 라이브러리 revision `1d0c9169b93f365f55856127974fda329358a2df`에 대해 [Actions #40208226589](https://github.com/kimjeon-il/Pando/actions/runs/40208226589) 검사. HGIS Germany 1914 원본 26개 주 GeoJSON과 해당 생성 지오메트리의 영구 보존 색인 항목은 모두 없으며, 현대 Natural Earth 국가 자료는 존재하나 실제 SHA-256 `52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb`가 독일 1914 레시피의 고정 기대값 `168286e9ee8e156cdbd19ebb026a13b66ebe2134cc89883834e32a4d58abe416`과 다르다. 따라서 C++ synthetic 4/4 성공을 실데이터 동등성으로 홍보하거나 Python 정본 생성기를 삭제해서는 안 된다. HGIS 자료 이용권한·고정 해시와 현대 헬골란트 2개 섬 geometry 일치 확인 후에만 승인. 북슐레스비히 원도엽 이미지는 새 revision에서도 보존 엔트리가 0이고 공간자료 11·보고서 7·출처 메타데이터 23개만 확인되어 일회성 코드 종료는 지도 이미지 원본 보존 이후에 진행한다.
- **C1 역사 카탈로그 Python 검사 이관:** `tests/test_v0280_historical_library.py`의 실제 소스 객체·과거/현대 동일 신분·동독과 북슐레스비히의 기준일 및 잠정 경계·동일 객체 내 국가별 역사 버전·소련 구성국 국기/부모 관계를 이미 존재하는 Node `territorial-library-data.test.mjs`에 통합했다. 기존 UI 서비스/복제·snapshot 검사는 현재 `territorial-library*.test.mjs`가 별도로 전수 검증하므로 폐기된 문자열 검사 중복은 삭제한다. `tests/application_source.py`의 마지막 소비자가 소멸해 Python 브리지도 함께 제거한다. 1922 자캅카스 건국을 반영하여 과거 Python의 소련 자식국 `정확히 15개` 고정은 새 출처에서 유효하지 않으므로 최소 15개·중복 및 국기/부모 데이터 계약으로 대체한다.
- **C1 국가 경계 Node 검사 이관:** `tests/test_v0301_borneo_geometry.py`의 258개 국가 원본/preview 형상, 폐합·방향·중복 좌표, 이집트 과거 보정 SHA 및 보르네오 IDN/MYS 접경 중복점 검사를 `tests/unit/borneo-country-geometry.test.mjs`로 이전하여 Python 테스트를 삭제한다. GEOS 위상 검증 정본은 기존 `pando-country-geometry-check` 및 GIS 생산 과정에 유지하며 자바스크립트 source assertion은 기존 구현 바이트와 대조한다. 데이터 정본 자체는 변경하지 않는다.
- **C1 역사 데이터 CI 근본 검증:** 동프로이센 r3 hash는 보관 원본 geometry를 대상으로 검증하고 Node 정규화 geometry는 보관 원본의 좌표·구조와 완전 동일하도록 검증한다. 자캅카스 SFSR은 1922-12-30~1936-12-04 존속, 승인되지 않은 국기 이미지는 추가하지 않고 15개 기존 SSR의 국기 계약과 분리한다. 보르네오 CI의 esbuild 모듈 누락은 Node 의존성 설치로 해결한다. 출처 원본 및 운영 지도 수정은 없다. CI 재검증 대기.
- **C1 공통 GIS 경계 연결망 검사 이식:** 기존 GEOS/PROJ 레시피 실행기에 읽기 전용 역사 LineString 교차 검사 추가. 다른 선형의 공유 끝점만 허용하며 내부 교차·겹침·T접합·자기 교차를 GEOS로 검출한다. Node 검증 도구가 사용 전후 입력의 SHA-256을 검사하고 구조/경계위상 회귀 fixture를 C++ 실행에 연결한다. 소련 카스피해 승인 ZIP에 대한 실제 동등성 검사 전에는 1922년 Python 생성기를 삭제하지 않는다.
- **C1 동프로이센 과거 승인본 포렌식(2026-10-26):** [역사 원본 SHA 감사 CI #40251487906](https://github.com/kimjeon-il/Pando/actions/runs/40251487906)에서 외부 저장소의 서로 다른 고정 리비전 `1879138b54b2c9f8c173bf5575b108e3f1f8139b`와 `63aebba20cf60cad314022c8aeb24c87922ceb6d`를 Git 원본 보관색인 SHA로 대조했다. 동프로이센 r3 GeoJSON은 두 시점 모두 동일한 전체 원본 SHA `78c64c328f76de923907b3beec12100b62c032af0ad858abe03183a61b726646`, 지오메트리 SHA `285e75670217a29020bf0dd7de323311f3cdc1e42e3efbb7c462be0ce09d2307`, 6,766 좌표·1 컴포넌트다. 반면 `metadata.geometrySha256`에는 이전부터 `54c45d4de9f5f16e9dffb06eec24aeaef8f89b82aa455fd7c26b1064fe716237`이 기록되어 원본과 불일치한다. 구 버전에서도 있었던 메타데이터 불일치를 **별도 미해결 출처 이슈로 명시**하고, CI는 원본 전체 SHA/실제 지오메트리 SHA/정규화 좌표 완전 동일성/기존 메타데이터의 불일치 상태를 모두 고정 확인한다. 독립 사료 검증 전 메타데이터를 암묵적으로 교체하거나 지오메트리를 수정하지 않는다.
- **C1 범용 역사 영토 검증 C++ 이전:** GEOS/PROJ 국가 재구성 엔진이 레시피 공통 `validation`의 승인 면적(EPSG:3035 평면 제곱킬로미터), 필수 내부·외부 지점(경계 포함 GEOSCovers), 좌표 총량 상한을 직접 검증하게 했다. Synthetic 음성·양성 네이티브 회귀를 추가했다. Python Shapely 테스트 제거 전 저장된 동독 1989 실제 도형의 검증·원본 출처 SHA를 별도 비교해야 한다.
- **C1 1914 독일 본토 레시피 Python 테스트 제거:** `tests/test_german_empire_1914_base.py`의 축별 선형 보정, Z 등 추가 ordinate 보존, 헬골란트 섬 2개 선택과 예외 규칙을 `pando-territorial-recipe` C++ 진짜 실행기를 대상으로 하는 Node 네이티브 테스트로 교체했다. [실제 네이티브 C++ CI #40252968464](https://github.com/kimjeon-il/Pando/actions/runs/40252968464) 통과 후 해당 Python 테스트를 제거한다. 다만 비상업적 1914 HGIS 원본·생성 결과가 고정 라이브러리에 없어 기존 실제 Python 본토 생성기는 계속 보존한다.
- **C1 동독 1989년 Python 위상 검사 이관·삭제:** 기존 `tests/test_v0300_east_germany_library.py`의 법적 존속기간·이름·기준일·영토 대체 규칙은 `tools/gis/verify-east-germany-partition.mjs`에 이전하고, Python `shapely`/`pyproj`를 이용하던 면적(EPSG:3035), 현재 DEU와의 차집합·상호 배제·재결합·공유 외곽 좌표 정본 검사를 기존 `pando-territorial-recipe --audit-partition` C++/GEOS/PROJ 경로로 옮겼다. 기존 DDR 레시피의 역사 주요 지점(서베를린 제외 포함)과 저장 좌표 전체 동등성도 함께 검증한다. [실제 동독 고정 라이브러리 CI #40278889862](https://github.com/kimjeon-il/Pando/actions/runs/40278889862) 성공, 원본 SHA `1942a4cadd7c142aa10adccd3927f80cd1db7ece38bf2f842ae573b1cc1bb4bc`, 면적 108,571.219km², DEU 밖 0km²·대칭차 0km², 공유 정점 2,166개 정본 재사용. Python 테스트 제거, 외부 원본·라이브러리 지도 무수정.
- **C1 승인 1922 카스피해 Python/C++ 전수 동등성 확인:** [실데이터 oracle CI #40278421864](https://github.com/kimjeon-il/Pando/actions/runs/40278421864)에서 동결된 `caspian-shoreline-completed-candidate-20261024.zip`(SHA `3df45ab6...`) 내부 선형 266개를 이전 Python/Shapely와 새 native GEOS/PROJ로 별도 재구성했다. 정점 21,771→7,063개, 68개 수면 내부 구멍, 모든 선형 좌표 및 tolerance 완전 일치(최대 0°), 수면 대칭차 0km², 보정 반복 0회. 같은 Ubuntu/GEOS/PROJ 실행 환경의 C++ 전체 출력 해시 `96021290ab356a54e0ac82ad88a99a9fcaf30dacef1f64dba727e40f9350888a`를 fixtures에 영구 고정하여 이후 CLI·지오메트리 변동을 Python 재설치 없이 자동 차단한다. 승인본·소유권·국경 객체 반영은 일체 변경하지 않는다.
- **C2 북슐레스비히 일회성 공개 WMS 서비스 조사기 종료:** `probe_north_schleswig_1914_prussian_wms.py`는 역사 국경선이나 지도 이미지를 제작하지 않고 공개 WMS 서비스 도엽 범위·이용권 정보 JSON만 수집한 작업이다. 결과 `german-denmark-1914-north-schleswig-001-026.wms-services.json` 1,686바이트는 고정 라이브러리 `63aebba20cf60cad314022c8aeb24c87922ceb6d`에 SHA-256 `bf52f49b7938000c4a2a2400627adc6307aa795510e9c22deece4eda1e5e3b39`로 영구 보관되었으며 [전수 원본 바이트 검사 #40279832756](https://github.com/kimjeon-il/Pando/actions/runs/40279832756) 통과. 이 조사기와 전용 Python/push 워크플로만 삭제한다. 41개 북슐레스비히 사료 중 원도엽 이미지 0개 문제는 그대로 미완료이고, 원도엽을 다운로드/중첩하는 다른 코드에는 이 삭제 승인 근거를 적용하지 않는다.
- **현재:** 처음 101개 중 26개 삭제, **75개 Python** 잔존 (최초 101개 기준, 통합 추가 파일은 별도 집계). 지도·AI·국경 생성기, 외부 원본·런타임은 미변경. 테스트 합격은 고정 synthetic fixture에 대한 것이며 전 세계 GeoNames 원본 바이트 전수 비교를 대신하지 않는다.
- **A2 의존성 차단 (삭제 선택지 없음):** `tools/library_data.py`(C/B Python 원본 생성기의 Node lease 호출), `tools/report_paths.py`(C/E Python의 보고서 경로), `tests/application_source.py`(B/C Python 테스트) 3개는 소비자가 아직 Python이다. *다음 B/C/E 변환 단위마다* 해당 사용처를 C++/Node로 옮기고, 마지막 사용처가 사라지는 커밋에서 래퍼/헬퍼를 삭제한다. 단순 파일 삭제로 CI나 데이터 출처를 깨지 않는다.
- **후속 단계:** B=Hydro·DEM 28개, C=역사국경 38개, D=QGIS·래스터 5개, E=AI 19개. A2의 세 파일은 이 그룹 안의 호출자 정리로 함께 제거되며 최종 검사 `git ls-files '*.py' '*.pyi' '*.ipynb'`는 0이어야 한다.

## 0. 범위와 불변 조건

1. **최종 완료:** 현재 저장소 `git ls-files '*.py' '*.pyi' '*.ipynb'` 0개. 저장소 소유의 Python CLI·테스트·Actions 인라인 Python·문서의 실행 명령을 모두 Node.js/네이티브 C++/CTest로 교체. `package.json`의 `test:python`·`test:gis-python`, `.python-version`, Python 전용 `requirements*.txt`·`setup-python` 같은 프로젝트 전용 자산을 사용처 없는 순서에 맞춰 정리.
2. **외부 도구 예외를 완료로 오인하지 않음:** QGIS, Emscripten, 빌드 도구가 내부적으로 Python을 탑재할 수 있지만 이것은 프로젝트에서 Python 스크립트를 실행하거나 배포하는 것과 구분해 기록. 프로젝트가 관리하는 QGIS Python 플러그인·AI Python 실행 경로는 네이티브 코드로 대체.
3. **사용자 산출물 무변경:** 역사 지도·GeoJSON·원본 압축 자료·출처·라이선스·단축 보고서·기존 도심 표기·런타임 바이너리를 계획 단계에서 수정하지 않음. 기존 증거는 외부 `PandoLab-library-data`와 아카이브에 보존. 임시 Actions 아티팩트만 남은 지도는 영구 보존 가능 여부와 재배포권을 확인한 뒤 코드 종료.
4. **기존 설계 유지:** 앱/웹 동일 `shared/core` 계산 정본, `tools/cpp` 네이티브 GIS 생성기, 자료 처리·보고서·CLI는 Node. GDAL·GEOS·PROJ·LibTorch·QGIS SDK 같은 무거운 종속성은 기본 WASM/앱 빌드에 링크하지 않고 독립 네이티브 빌드로 분리.
5. **작업 단위:** 전환 대상별로 기존 Python에서 입력·출력·오류·해시 oracle을 먼저 고정 → Node/C++ 구현 → 동등성 검사 → 호출처·테스트·문서·Actions를 같은 커밋에서 전환 → Python 삭제. 각 작업 범위 이외의 리팩터링 금지.
6. **검증 현실화:** 직전 Node 전환 커밋 `61aa02a`의 수계 패키지 Range 전용 CI는 성공했지만 다른 광역 CI에는 실패/취소가 있음. 선행 회귀와 작업 유발 오류를 구분한 기준표를 만들고, 신규 도구의 실제 Node 테스트 3개를 먼저 실행한 뒤 다음 전환에 진입. 단순 구문 검사만으로 통과 선언 금지.

## 통합 추가 검토 목록

2026-10-25 `work/ui`의 승인된 Map Toolkit 0.4.1 작업을 통합하면서 아래 파일 1개를 별도로 검토했다. 기존 101개 원본 목록은 변경하지 않는다. 원본 목록의 B1 잔여 상한은 86개였으며 C2에서 3개를 추가로 이관·제거했으므로 현재 상한은 83개다. 통합 추가 파일 1개를 포함한 총 상한은 84개이며 새 디렉터리 전체를 허용하지 않는다. 추가 파일은 기존 지도 수집기의 다운로드·출처 기록을 CLI와 비공개 Work 플러그인이 공유하도록 추출한 정본이며, GIS CLI를 Python으로 되돌리는 경로가 아니다. 남은 Python 실행 경로를 제거한다는 최종 목표는 동일하며 이 파일과 호출자는 지도 분석 전환 묶음에서 함께 이식한다.

- `plugins/pando-map-tools/lib/map_source.py`

## 1. 단기 작업: Node 기반 파이프라인·래퍼 (A: 11개)

### A0. 선행 회귀 고정

- 직전 전환의 `pnpm test:gis-node` 또는 `node --test` 3개(다운로드, Hydro packfile, 도시 배치)를 **실행하여** 테스트 로그와 실패원인 확정. 같은 입력에서 실제 반환·예외·SHA·파일 쓰기 안전성 검사. `World Dataset Stage 3 Gate`의 기저 실패도 별도 기록.
- Node 24·pnpm 락파일 고정. Python 데이터 oracle은 기존 커밋의 **임시 작업 디렉터리**에서만 실행하고 앱 데이터나 승인 조사결과는 건드리지 않음.

### A1. GeoNames 후보 생성기: `tools/build-place-candidates.py` → `tools/build-place-candidates.mjs`

- 원본 경계: `cities500.zip` 우선, `allCountries.zip` 대체/커버리지 감사; `fetch → build → review` 명령, 명시적 공식 출처·라이선스·ETag/Last-Modified·다운로드 ZIP SHA·ZIP 내부 파일 CRC 보존.
- 구현: Node 24 스트리밍 ZIP reader(직접 pin된 안전한 ZIP 라이브러리와 CRC 검증), `readline` 기반 NDJSON 스트리밍, 정수/유니코드·현대 feature-code/poplulation 선별, 안전한 원본 캐시·임시 파일 승격. 기존 `download-terrain-source.mjs`를 재사용하고 대용량 ZIP 전체 메모리 로딩 금지.
- **테스트 23개 계약 전환:** 인구 0, 행정 코드, 비채택 코드, 별칭·이름 중복 및 동명이촌, invalid coordinates, 현대 국가코드, SHA 불일치, 원본 변경·ZIP CRC 불일치, fallback, 검토 원장 ID 단위 retain/hold/exclude와 출처 일치, 생성물 불변성. `tests/test_place_candidates.py`를 `tests/unit/place-candidates.test.mjs` 및 고정 ZIP fixture로 이관.
- 완료: 같은 고정 ZIP·정책표에서 후보 **ID 집합/순서, 포함·제외 결정, 통계, 리뷰 요약, NDJSON 의미·가능한 바이트 결과** 동등성 확인. 현대 인구·국가코드로 역사적 신분·위계 추론 금지. 실제 공식 자료가 없는 CI에서는 fixture 검사만 통과로 기록하고 전 세계 실데이터 동등성을 통과로 간주하지 않음.

### A2. 파이프라인·도구 소유권 단일화

- `tools/library_data.py`는 기존 `tools/library-data.mjs`의 `withLibraryOutputs` 등으로 호출처를 **먼저** 전환하고 삭제. `tools/report_paths.py`는 `tools/report-paths.mjs`에 `reportArgument`/형제 파일 경로 처리까지 포팅하고 호출처 전환 후 삭제. 외부 라이브러리 권한 lease, hydration, 쓰기/원본 보존, 브랜치별 경로를 동일 계약으로 검사.
- `scripts/gis/run-source.py` → `scripts/gis/run-source.mjs`: Node/native 허용목록, `--execute` 명시 동의 및 기본 dry-run, 저장소 경계/인수 이스케이프, 작업 원본 경로 검증. Python 생성기 대상은 대체 실행 파일이 준비되는 즉시 목록 교체하고 **마지막 Python 대상 교체 후** `.py` 실행기 삭제.
- `scripts/summarize-boundary-capture-evidence.py` → Node 파일 요약기: ZIP·trace 크기 상한, 해시/컨텍스트 추출, 원본 불변성과 기존 캡처 비교 테스트 유지.
- `tests/application_source.py`, `tests/test_application_source.py`, `tests/test_font_assets.py`, `tests/test_p4_gis_runner.py`, `tests/test_report_paths.py`: 현재 Node `scripts/lib/application-source.mjs`, 보고서·폰트·CLI 검사에 통합. `tests/application_source.py`는 역사/수계 Python 테스트가 마지막으로 교체될 때 삭제. `package.json`·관련 Actions·문서 참조를 동시 수정.
- 완료: Node 외부 라이브러리 write lease·보고서 경로·dry-run 계약이 통과하고 이 묶음의 Python이 0개.

## 2. C++ GIS + Node 분석: 수계·지형 (B: 28개)

### B1. Hydro 검증·명칭 데이터 파이프라인

- `tools/inventory-hydro-names.py`, `tools/inventory-osm-hydronyms.py`, `tools/gis/hydro_independent_name_policy.py`, `tools/gis/prepare_hydro_name_replacement_bundle.py`: Node로 옮겨 기존 `decode-hydro-connectivity.mjs`, 명칭 검토/승격 스크립트와 하나의 소유자로 정리.
- `tools/gis/check_official_usgs_hydro_gauges.py`, `compare_osm_hydro_natural_earth.py`, `verify_independent_river_point_anchors.py`, `verify_osm_hydro_batch01/02/03_points.py`, `verify_victorian_yarra_source.py`: HTTP·출처·보고서 처리 Node + 선형·점간 거리/교차·좌표 변환 C++ GIS utility. 출처 식별은 근접한 점만으로 강 전체의 동일성을 확정하지 않는 기존 정책 유지. OSM 출처 교체가 끝난 일회성 배치는 **최종 조사결과 보존 후 제거**하고 Node/C++ 공통 검사만 유지.
- 해당 Python 수계 검증 테스트는 Node/CTest로 포팅하고, ODbL/출처 기록 및 독립 자료 해시/명칭 변경 범위가 어긋나면 배포 차단.

### B2. Hydro 지오메트리 계산

- `tools/build-hydro-tiles.py`, `tools/calibrate-hydro.py`, `tools/hydro_connectivity.py`, `tools/repair-hydro-connectivity.py`, `tools/verify-hydro-connectivity.py` → `tools/cpp/hydro/*`의 GDAL/GEOS 네이티브 코드 + Node 드라이버. 최종 하천 연결·해안 접속·유역 중요도·단계/표시 기준·논리 수계 ID·자원 순서·좌표 1e-6° 양자화/varint 포맷을 그대로 유지.
- 후보→본류·지류 경로, 하구/내륙 종점, border-aligned 구간 및 연결 실패 항목에 대해 샘플 + 고정 원본 전수 재생성 테스트. 시스템 ID, 객체 수, 좌표·위상, 바이트/manifest 해시(해당 산출물이 완전 결정적인 경우), 허용된 형식 버전의 명시적 이관을 검사.
- 기존 수계 JS 런타임·WASM은 바꾸지 않으며 GIS용 GDAL/GEOS를 WASM에 유입시키지 않는다.

### B3. DEM·물리 지형 생성

- `tools/build-physical-data.py`, `tools/build-terrain-dem.py`, `tools/build-terrain-preview.py`, `tools/verify-terrain-dem.py` → GDAL C++ Warp/Window, native PNG/WebP encoder(버전 pin), Node 산출물 관리/검증.
- 고정 ETOPO/색상 tint, mask·NoData, 극지 gutter, LOD 0–5, PNG/WebP RGBA와 투명도, 해시/manifest, 저장소 외부 대용량 파일을 검증. 픽셀 의미 동등성과 바이너리 byte 동등성은 분리해 기록. 인코더 차이가 있으면 검토된 별도 재생성 커밋에서만 manifest 갱신.
- `tests/python/test_build_terrain_*.py`, 수계 Python 테스트를 각각 Node 고정 입력·CTest C++ 연산 검사로 옮긴 후 삭제.

## 3. 역사 GIS·국경 생성/일회성 조사 마감 (C: 38개, 최초 매니페스트 기준)

### C1. 계속 사용할 영토 재구성 엔진

- 독일 1914 기본·현대 해안 후보, 북슐레스비히 후보, Cecilienkoog 및 소련/카스피해·LSIB 생성/보정 함수 → 기존 `tools/cpp/build-territorial-recipe.cpp` 중심의 GEOS/PROJ C++ 기능으로 합치고 Node가 조사 출처·원본 해시·레시피·보고서를 관리.
- 구체적으로 `build_german_empire_1914_base.py`, `build_german_empire_1914_modern_coast.py`, `build_german_cecilienkoog_1905_provisional.py`, `tools/gis/apply_ussr_1922_caspian.py`, `supplement-lsib-boundaries.py`를 대체하는 네이티브 명령·레시피를 작성. 북슐레스비히 세부 생성기 `build_north_schleswig_1914_001_026.py`는 조사 자체 폐기 대상으로 별도 종료한다. 유지할 다른 형태의 도구가 없더라도 Python 파일은 0으로 만듦.
- 기존 source ZIP·라이선스·시점(1801년 이후)·확정/잠정 표시·도법/축척(Natural Earth 1:10M)·위상·경계 미확정 지점과 증거를 보존. 미세한 좌표 보정을 자동 승인하지 않음.

### C2. 원본 수집/일회성 이미지 조사 정리

- `fetch-east-germany-sources.py`, `fetch_german_empire_1914_source.py` → Node 안전 수집·출처 메타데이터·해시/캐시 도구로 통합.
- **철회:** `collect_north_schleswig_1914_001_026.py`, `audit_north_schleswig_*`, `render_north_schleswig_*`, `review_north_schleswig_*`, `verify_north_schleswig_*` 및 전용 지도 서비스 조사·중첩·WMS 보존 코드는 사용자 승인으로 삭제한다. 자료의 고정 원본 재수집·영구 보존·권리 검증을 완료 기준으로 두지 않는다. 기존 운영 지도 객체/일반 역사 검증은 유지한다.
- `tools/gis/baikonur_official_reference.py`, `tools/gis/report_ussr_1922_caspian.py`는 Node 근거·리포트 도구로 이전하고, `verify-lsib-country-sources.py`, `verify-lsib-screen-delta.py`는 네이티브 지오메트리 검사로 이전.
- 역사/영토 Python 검사 8개는 Node/CTest에 동등성 계약을 옮긴 뒤 제거. 사용하지 않는 별도 조사 스크립트도 **그대로 남겨두지 않고** 증거 보존 절차를 밟아 종료한다.

## 4. 외부 어댑터도 Python 없이 교체 (D: 5개)

- `tools/qgis/bootstrap.py`, `tools/qgis/bridge.py`: 현 QGIS Python 플러그인 부트스트랩·QGIS MCP 클라이언트 의존을 제거. Qt/QGIS 네이티브 C++ 엔드포인트에서 `start/status/open/export/normalize`, EPSG:4326, GeoJSON, QVariantMap 필드·ID·CRS·기존 파일 덮어쓰기 금지와 인증 루프백을 구현하고 Node MCP/CLI 어댑터로 연결. 현 문서가 제공하는 QGIS MCP 27개 동작의 실제 사용처를 선별하여 대체 명령 매핑·회귀 기준을 수립한다. 모든 사용 기능을 이식하기 전 구형 플러그인 의존을 끊지 않는다.
- `plugins/pando-map-tools/lib/raster.py`: PNG/JPEG/EXIF·crop/resize/alpha는 Node 고정 버전 이미지 처리, PDF 페이지·MuPDF 관련 기능은 네이티브 MuPDF C/C++ helper로 대체. 기존 stdin JSON 헤더 + newline + RGBA/PNG 바이너리 stdout, 16MP 입력 제한과 실패 처리를 보존.
- `tests/python/test_qgis_bridge.py`, `tests/test_map_plugin_raster.py`는 Node/CTest+실제 QGIS 설치 환경 smoke(별도 실행)에 교체하고 삭제.
- **중요:** 시스템에 설치된 QGIS 내부 언어·외부 공급자 파일까지 제거한다는 뜻은 아니다. 판도연구소의 QGIS 접속 구현과 실행 경로가 Python을 호출하지 않아야 완료다.

## 5. 지도 이미지 AI 학습 전면 전환 (E: 19개)

- `acquire-sources.py`, `corpus.py`, `macro.py`, `publisher.py`, `semap.py`, `prepare-analysis-images.py`는 Node 기반 출처/ZIP 스트리밍·라이선스/검토 코퍼스 계약 + 네이티브 MuPDF/이미지 처리로 전환. 원본 PDF·이미지와 검수 라벨을 바꾸지 않는다.
- `evaluation.py`는 픽셀 마스크 F1/IoU·원본 해상도 단위 평가를 Node TypedArray 또는 C++로 이식. 기존 테스트 fixture와 채널별 수치·검증 분리(훈련/검증/평가 세트)를 유지.
- `model.py`, `train.py`, `inspect-checkpoint.py`, `verify-model.py` → 별도 `tools/cpp/reference-analysis` 네이티브 LibTorch C++17 학습/검증 실행기. MobileNetV3-Large 기반 encoder·경계 loss, AdamW, CUDA/CPU, deterministic seed, 모델 상태/optimizer 체크포인트, 평가 인덱스를 고정. 공식 LibTorch C++ 프런트엔드의 `torch::nn`/`torch::optim`/`torch::data` 이용.
- **ONNX 내보내기 필수 설계 게이트:** Python의 `torch.onnx.export`를 계속 호출하는 방식은 최종안에서 금지. C++/Node ONNX 그래프·initializer 직렬화 경로를 구축하고 기존 `tools/reference-analysis/verify-trained-onnx.mjs` 및 실제 브라우저 ONNX Runtime Web에서 입력·출력 이름, shape, 유한값, 채널·float32 수치 및 허용 오차를 확인한다. ONNX Runtime C++ Training도 Python 생성 아티팩트를 요구할 수 있어 'Python 없음' 목표를 자동 해결한다고 간주하지 않음.
- 초기 승인/학습 산출물이 없는 경우는 검증된 실제 지도 코퍼스와 독립 라벨을 우선 확보하고 학습·평가 결과로 성공을 판단. 허위 학습 checkpoint 생성 금지. 기존 PyTorch `.pt` 가중치의 일회성 이전은 이행 중 별도 임시 환경에서 수행할 수 있으나 최종 앱·CI·저장소 실행기는 Python 의존 0.
- 관련 Python 테스트 8개를 Node/CTest에 모두 이관. C++ 네이티브 학습/ONNX 변환에 대한 실제 모델 회귀 검사 없이는 Python 삭제만으로 성공 표시 금지.

## 6. 최종 정리와 수용 기준

- **모든 101개에 명확한 종료 조치:** 첨부 목록 A~E 중 어느 `.py`도 `유지`로 완료 처리하지 않음. 이식은 새 코드 + 테스트 + 호출처 전환 + 옛 파일 삭제를 한 변경으로 묶으며, 종료 대상은 지도/보고서/원본 파일 영구 보존 증거가 있은 뒤 삭제.
- **호출 그래프:** `.github/workflows/**`, `.github/actions/**`, `scripts/**`, `package.json`, `AGENTS.md`, 문서와 플러그인 skill에 남은 프로젝트 소유 Python 코드·`python - <<'PY'`·`python -m`·`.py` 참조를 검색하고 유효한 Node/CTest 명령으로 고침. 오래된 문서 속 역사 기록만 보존 가치에 따라 설명으로 남기되 실행 명령은 사용 중인 명령으로 교체.
- **재현성:** 소스/결과물 해시와 라이선스, 수정 금지 원본, 지도 레이어의 ID·좌표·위상·표시 결과, 허용되는 레시피/버전 변경을 동등성 검사로 통제.
- **최종 게이트:** `git ls-files '*.py' '*.pyi' '*.ipynb'` = 0, 판도 소유 Python 스크립트/CI/문서 실행 호출 = 0, 전환된 Node·CTest 및 핵심 브라우저 smoke, Windows/Linux GIS 네이티브·QGIS, 학습/ONNX WASM 검사 통과. 잔여 외부 SDK Python은 별도 명시하고 '전체 OS Python 0'으로 홍보하지 않음.
- **스테이징:** `work/gis`에서 작은 기능별 커밋으로 진행하며 다른 작업 브랜치는 자동 변경하지 않음. 매 커밋 대상별 입력 fixture·예상/실제 차이·검증 범위를 남기고 마지막에만 통합 검사를 수행한다.

## 부록. 전수 분류 매니페스트

다음 목록은 커밋 `61aa02a9fd09`의 **Python 101개 전체**를 직접 열거한다. 누락·중복 0개로 대조하였다.

### A. Node 파이프라인·도구 — 11개

- `scripts/gis/run-source.py`
- `scripts/summarize-boundary-capture-evidence.py`
- `tests/application_source.py`
- `tests/test_application_source.py`
- `tests/test_font_assets.py`
- `tests/test_p4_gis_runner.py`
- `tests/test_place_candidates.py`
- `tests/test_report_paths.py`
- `tools/build-place-candidates.py`
- `tools/library_data.py`
- `tools/report_paths.py`

### B. Hydro·DEM — 28개

- `tests/python/test_build_terrain_dem.py`
- `tests/python/test_build_terrain_preview.py`
- `tests/test_hydro_calibration.py`
- `tests/test_hydro_connectivity.py`
- `tests/test_hydro_independent_names.py`
- `tests/test_hydro_name_inventory.py`
- `tests/test_hydro_tiles.py`
- `tests/test_hydronym_spacing.py`
- `tools/build-hydro-tiles.py`
- `tools/build-physical-data.py`
- `tools/build-terrain-dem.py`
- `tools/build-terrain-preview.py`
- `tools/calibrate-hydro.py`
- `tools/gis/check_official_usgs_hydro_gauges.py`
- `tools/gis/compare_osm_hydro_natural_earth.py`
- `tools/gis/hydro_independent_name_policy.py`
- `tools/gis/prepare_hydro_name_replacement_bundle.py`
- `tools/gis/verify_independent_river_point_anchors.py`
- `tools/gis/verify_osm_hydro_batch01_anchors.py`
- `tools/gis/verify_osm_hydro_batch02_points.py`
- `tools/gis/verify_osm_hydro_batch03_points.py`
- `tools/gis/verify_victorian_yarra_source.py`
- `tools/hydro_connectivity.py`
- `tools/inventory-hydro-names.py`
- `tools/inventory-osm-hydronyms.py`
- `tools/repair-hydro-connectivity.py`
- `tools/verify-hydro-connectivity.py`
- `tools/verify-terrain-dem.py`

### C. 역사 국경·일회성 GIS — 38개

- `tests/test_baikonur_official_reference.py`
- `tests/test_german_empire_1914_base.py`
- `tests/test_lsib_boundary_supplement.py`
- `tests/test_ussr_1922_caspian.py`
- `tests/test_v0280_historical_library.py`
- `tests/test_v0300_east_germany_library.py`
- `tests/test_v0301_borneo_geometry.py`
- `tests/test_v0306_layer_lock_sync.py`
- `tools/audit_north_schleswig_1914_001_026.py`
- `tools/audit_north_schleswig_1914_001_026_sheets.py`
- `tools/audit_north_schleswig_1914_stone26_split.py`
- `tools/build_german_cecilienkoog_1905_provisional.py`
- `tools/build_german_empire_1914_base.py`
- `tools/build_german_empire_1914_modern_coast.py`
- `tools/build_north_schleswig_1914_001_026.py`
- `tools/check_north_schleswig_1914_slub_wms.py`
- `tools/collect_north_schleswig_1914_001_026.py`
- `tools/discover_north_schleswig_1914_map_services.py`
- `tools/fetch-east-germany-sources.py`
- `tools/fetch_german_empire_1914_source.py`
- `tools/fetch_north_schleswig_1864_west_sources.py`
- `tools/gis/apply_ussr_1922_caspian.py`
- `tools/gis/baikonur_official_reference.py`
- `tools/gis/report_ussr_1922_caspian.py`
- `tools/probe_german_empire_1914_coast_period_rasters.py`
- `tools/probe_german_empire_coast_microtiles.py`
- `tools/probe_north_schleswig_1914_prussian_wms.py`
- `tools/render_german_cecilienkoog_1905_qa.py`
- `tools/render_north_schleswig_1914_slub_overlays.py`
- `tools/review_north_schleswig_1914_hugum_hotspots.py`
- `tools/supplement-lsib-boundaries.py`
- `tools/verify-lsib-country-sources.py`
- `tools/verify-lsib-screen-delta.py`
- `tools/verify_north_schleswig_1914_0619_hugum.py`
- `tools/verify_north_schleswig_1914_0717_coast.py`
- `tools/verify_north_schleswig_1914_0718_east.py`
- `tools/verify_north_schleswig_1914_0718_west.py`
- `tools/verify_north_schleswig_1914_0719_spandet.py`

### D. QGIS·래스터 어댑터 — 5개

- `plugins/pando-map-tools/lib/raster.py`
- `tests/python/test_qgis_bridge.py`
- `tests/test_map_plugin_raster.py`
- `tools/qgis/bootstrap.py`
- `tools/qgis/bridge.py`

### E. AI 분석·학습 — 19개

- `tests/python/test_reference_analysis_conditions.py`
- `tests/python/test_reference_analysis_corpus.py`
- `tests/python/test_reference_analysis_evaluation.py`
- `tests/python/test_reference_analysis_macro.py`
- `tests/python/test_reference_analysis_publisher.py`
- `tests/python/test_reference_analysis_semap.py`
- `tests/python/test_reference_analysis_sources.py`
- `tests/reference-analysis/test_model.py`
- `tools/reference-analysis/acquire-sources.py`
- `tools/reference-analysis/corpus.py`
- `tools/reference-analysis/evaluation.py`
- `tools/reference-analysis/inspect-checkpoint.py`
- `tools/reference-analysis/macro.py`
- `tools/reference-analysis/model.py`
- `tools/reference-analysis/prepare-analysis-images.py`
- `tools/reference-analysis/publisher.py`
- `tools/reference-analysis/semap.py`
- `tools/reference-analysis/train.py`
- `tools/reference-analysis/verify-model.py`

- **C1 1922 카스피해 물리 자산·보고서 Node/C++ 이전(2026-10-26):** 고정된 현대 세계 육지 자료에는 카스피해 수정 범위 밖의 기존 GEOS 유효성 결함이 있음을 확인했다. 전 세계 원본을 암묵적으로 보정하지 않고, 변경 구역 내부와 구역 밖 변동 0을 C++로 검증하도록 수정하여 [실제 원본 GIS CI #40311376516](https://github.com/kimjeon-il/Pando/actions/runs/40311376516)가 통과했다. 세계 원본·게시된 역사 육지의 기존 불완전성은 정직하게 메트릭으로 남겨 둔다. 보고서는 Node가 고정 라이브러리 revision `68380579a7c7a1bd8ec97683b7517502c1389c3c`의 당시 보고서·검증 JSON·비교 지도 PNG 3개를 원본 바이트/SHA로 확인한 뒤, 새 C++ 감사 결과와 결합해 축약 생성한다. 국가 5개 중 4개가 승인 ZIP과 실제 위상 차이를 보이므로 자동 재반영 금지 상태를 명시하며 [실제 보고서 CI #40312343966](https://github.com/kimjeon-il/Pando/actions/runs/40312343966)가 통과했다. 옛 Python 보고서 생성기는 아카이브 내 원본 이미지·보고서 재검증을 전제로 퇴역시키되, 소련 역사 데이터의 배포 승인이나 원본 수정은 수행하지 않았다.

- **C1 1922 소련 후속 승인 경계 판정 전환(2026-10-26):** 최초 승인 ZIP `ussr-1922-v2-reviewed-master-20261023.zip`의 형상은 역사 출처로 계속 고정하지만, 2026-10-25 드네스트르강 보정과 유럽 외곽/공화국 공유선 보정이 이미 적용된 4개 객체를 ZIP과 동일하게 되돌리거나 오류로 판정하지 않는다. Node `audit-ussr-1922-approved-followups.mjs`에서 두 번의 보정 `integration-proof` 및 원래 application/guard 보고서 5개의 고정 SHA-256·기간·대상 ID·선행/후행 지오메트리 해시를 검증하여 최신 데이터 핀 `68380579a7c7a1bd8ec97683b7517502c1389c3c`의 네 개 역사 버전과 일치함을 확인했다. 제5 객체 자캅카스 SFSR은 기존 ZIP 형상을 정확히 보존한다. `pando-territorial-recipe --audit-ussr-1922-partition`에서 부모−구성공화국 합집합 0도², 합집합−부모 0도², 6쌍 최대 겹침 0도²를 실제 GEOS로 계산하여 모두 통과했다. 원본 ZIP 대비 차이 4건은 보관 포렌식 결과로 계속 기록하면서 요약 보고서에서는 현재 정본 미해결 위상 오류 **0건**으로 구분한다. [전체 역사 GIS native CI #40333224979](https://github.com/kimjeon-il/Pando/actions/runs/40333224979) 통과. 라이브러리 국가 폴리곤·수역·외부 자료 핀·배포는 수정하지 않았고, 후속 승인 근거가 바뀌면 이 검증은 자동 실패한다.

- **C1 독일제국 1914년 HGIS 원본 무결성·참조 자료 감사(2026-10-26):** 고정 외부 자료 리비전 `68380579a7c7a1bd8ec97683b7517502c1389c3c`의 실제 `archive/index.json` 및 원본 바이트를 `tools/gis/verify-german-1914-originals.mjs`로 검사했다. Natural Earth 5.1.1 전체 국가 원본 12,415,778바이트 SHA `52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb`, 국가 258개, DEU 1개 및 C++/GEOS 헬골란트·뒤네 섬 2개 실데이터 검증이 통과했다. 잘못된 기존 레시피 SHA를 원본과 동일한 64자리 값으로 수정했다. 보존된 HistoGIS `deutsches-reich` 원본 SHA `0a75047b62dc835abd5a47282a7df71dedb4802395cd476d68f645fb5b81e9e9`, 작업 지도 SHA `1fc5aa30b821b981dc67d71dc62dd8643e1b24b006779c64489f7ec3a0cb2bfb`는 검증했으나, 이는 Harvard HGIS 1914 주 26개 원본과 **서로 다른 자료**다. 목표 HGIS `hgis-germany-states-1914.geojson`과 해당 원본 기반 oracle은 보존 색인상 **부재**하므로 전체 C++/Python 실데이터 동등성은 차단 상태다. Harvard WFS 2개 경로 읽기 전용 조사는 프록시 연결 실패 및 기존 WFS HTTP 403으로 끝났으며 원본 권리를 우회해 자동 보관하거나 배포하지 않았다. [실제 NE/C++ 감사 CI #40336296933](https://github.com/kimjeon-il/Pando/actions/runs/40336296933) 및 [공식 WFS 조사 포함 CI #40337019482](https://github.com/kimjeon-il/Pando/actions/runs/40337019482) 통과. **기존 Python 생산 생성기 보존**, 26개 원본 SHA·이용권한 및 Python/C++ 전체 동등성 확인 전까지 승인 금지. 코드 감사 범위에서 라이브러리 원본·런타임·배포는 무수정.

- **C1 소련 1922년 일회성 Python 적용기 퇴역(2026-10-26):** `tools/gis/apply_ussr_1922_caspian.py`의 일회성 국가 적용·카스피해 수역 재생성·보고서 생성 기능은 현재 고정 ZIP을 그대로 사용하는 `replay-ussr-1922-countries.mjs`, `replay-ussr-1922-physical.mjs`, GEOS C++ `historical-caspian-*`, `report-ussr-1922-caspian.mjs`와 [원본 실자료 CI #40333224979](https://github.com/kimjeon-il/Pando/actions/runs/40333224979)로 대체되어 있다. 남은 아랄해 명칭 보정의 실제 게시본 검사는 `verify-ussr-1922-aral-names.mjs`로 이관해 원본 보존 보고서 `application-proof.json`의 SHA, 남·북 아랄해 2개 명칭/이전 이름 alias, 1,355개 호수, Hydro `hydro.bin` 전체 SHA와 인덱스/지오메트리 압축 샤드 4개를 실데이터에서 대조했다. [실제 GIS CI #40339824284](https://github.com/kimjeon-il/Pando/actions/runs/40339824284) 통과 후 `tools/gis/apply_ussr_1922_caspian.py` 및 마지막 소비자 `tests/test_ussr_1922_caspian.py`를 함께 제거한다. 실행 가능한 이전 Python 적용기가 기존 작업결과를 덮어쓰는 위험도 종료한다. 승인 원본 ZIP·지도·검증 보고서·국가·수역·기간·외부 라이브러리 핀은 일체 수정하지 않는다.

- **C2 북슐레스비히 4개 WMS 원도엽 접근·시각 검토 Node 이전(2026-10-26):** 기존 Python `check_north_schleswig_1914_slub_wms.py`가 수행하던 SLUB 도엽 접근·샘플 이미지 검사와 임시 결과 기록을 `tools/gis/preserve-north-schleswig-period-maps.mjs` 및 Node 테스트로 전환했다. 고정 라이브러리의 `0619·0717·0718·0719` 도엽/카탈로그/후보선/구 WMS 검증 JSON을 각 원본 SHA와 대조한 후 공식 WMS 좌표계 축 순서로 실영상 PNG 4개를 내려받고, IDAT 압축·PNG 필터·실제 불투명 화소까지 검사했다. 같은 4개 지도의 별도 임시 SVG 중첩시안도 Node에서 만들며 기존 원본 WMS 응답 SHA-256을 별도 기록한다. [실제 Node WMS·SVG CI #40342241974](https://github.com/kimjeon-il/Pando/actions/runs/40342241974)에서 **4/4 영상 확보 및 중첩 시안 생성** 통과. 단, 이는 원본 도엽 **전체 사진 스캔이 아닌 WMS 제공 지도 영상**이고 GitHub Actions 리뷰 아티팩트는 14일 만료된다. SLUB/Deutsche Fotothek 도엽별 재이용 권리를 미확인한 상태이므로 이미지를 공개 라이브러리에 임의 재배포하지 않으며 **영구 원본 보존 완료·역사 국경 최종 승인이라고 하지 않는다.** 보존 색인에 있는 옛 `.slub-wms-probe.json`은 기존 연구 증거로 유지한다. 동일 역할의 Python WMS 표본 검사기만 퇴역시키고, 고유 검토 이미지 산출물이 아직 영구 보존되지 않은 다른 Python 현장조사/PNG 생성기는 삭제하지 않는다.
