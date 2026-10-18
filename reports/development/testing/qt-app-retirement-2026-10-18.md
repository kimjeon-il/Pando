# 구 Qt 앱 전체 제거

> 보고서 ID: DEV-QT-RETIRE-20261018 · 상태: verified-focused-runtime · 지도 반영: not-applicable
> 원문 최종 수정: 2026-10-18
> 조사 기준: 통합 Web/App 커밋 `43d13b10ef0276ada9dd91430d59b3266ae7e286` + work/ui 미커밋 변경
> 원본·출처: [파일·해시·검사 기록](qt-app-retirement-2026-10-18.json)

## 제거 범위

사용자의 후속 지시(“보존하지 말고 / 다 지우라고 / 옛날 앱 관련된거 전부”)에 따라 초기 독립 engine·구 앱 fixture 보존 방침을 취소했다. `native/` 전체 2132개 파일을 제거했으며, 앱 전용 도구·검사·워크플로·보고서까지 현재 트리에서 총 2259개 파일(156,122,154 bytes)을 제거했다. 삭제한 workflow는 19개다. Git 이력과 별도 원본 백업 저장소는 수정하지 않았다.

현재 앱 기준은 `apps/web-shell`이다. 웹 화면·Worker·WASM과 자료를 사용한다. 현재 웹·공통 코어가 실제 소비하는 고정 입력 7개와 DEM 메타데이터를 새 소유 위치로 옮겼으며 원본 8개 파일의 바이트와 SHA-256이 일치한다. DEM/tint의 9개 입력 pin은 별도 작은 계약으로 보관한다. 현재 Web 자산, 앱 실행 코드와 공통 계산 소스는 기준 커밋과 같다. `shared/tests`의 fixture 경로 두 곳과 앱 README만 이 영역에서 변경했다.

구 앱의 빌드 variant·Qt 설치·실행·화면 CI와 별도 앱 미러 게시 단계를 제거했다. 공통 코어·WASM·GIS·웹 브라우저·Tauri 검사는 각각 유지한다. Pages는 현재 세계 manifest를 기준으로 자산 크기·해시·목록을 검사한다.

## 필요한 검사 결과

- 삭제 경계·변경 분류·문서 경로·성능 기준 계약: 33 통과. 후속 관련 수정 18개 재검사 통과.
- 생성물 트랜잭션: 작은 임시 Git 저장소 사례 19 통과. 실제 원격 푸시나 생성물 재생성은 하지 않았다.
- 현재 자료 검사기: 작은 Node fixture 12 통과, Python fixture 5 통과. 보고서 경로 Python 4 통과.
- Pages·staging 경계: 21 통과, Windows symlink 1 생략. 이 가운데 monorepo staging 6개는 부모 실행에서도 확인했다. 중복 실행 수를 합산해 별도 전체 검사 수로 표시하지 않는다.
- 수정 JS 37개 ESLint 통과. 고정 원본 JS fixture는 원본 바이트 검증 대상으로 두며 lint를 위해 수정하지 않았다.
- 공통 core의 CMake 구성 성공. GNU 13.1.0·ZLIB 1.2.13을 사용했고 Qt 패키지·앱 타깃은 요청하지 않았다. 컴파일·CTest·앱 실행은 하지 않았다.

최종 읽기 전용 검토에서 추가 중요 결함은 발견하지 못했다. 현재 JS import, 공유 fixture·terrain 계약 경로, Pages helper 및 P2 연결을 확인했다.

## 초기 검사 차단 기록

WASM을 실제 로드하는 검사 파일 4개는 `PL-CORE-PREREQUISITE-STALE`로 시작하지 못했다. 기준 커밋부터 `shared/core/src/geometrypredicates.cpp`가 packaged WASM의 소스 pin과 다르다. 이번 `shared/tests/CMakeLists.txt` fixture 경로 변경도 전체 shared 소스 해시에 포함되므로, 후속 WASM 빌드·패키징 후 검사해야 한다. pin을 수동으로 고치거나 검사를 우회하지 않았다.

앱·BAT·Qt/offscreen 화면·대규모 세계 자료·성능·전체 테스트는 실행하지 않았다. 실제 앱 응답성, 새 WASM 빌드 및 배포 성공은 미검증이다. main 병합·커밋·푸시·배포·포터블 제작, SDK/컴파일러/캐시 삭제는 하지 않았다.

## WASM 재빌드 후속 검증

사용자가 WASM 불일치 해결, 커밋·푸시·main 병합·배포를 추가 승인했다. 고정 Emscripten 4.0.20으로 [WASM 전용 P2 실행](https://github.com/kimjeon-il/Pando/actions/runs/39099036063)을 수행했고 빌드·실제 소스 식별값·패키지 해시·관련 계산 검사가 통과했다. 산출물 커밋은 `4355c7ff`다.

앞서 차단됐던 검사 파일 4개를 재실행했다. 테스트 helper 두 곳이 schema v1과 propertyBindings 누락 입력을 만들던 문제는 현재 TIMELINE_RECORD_SCHEMA_VERSION과 빈 propertyBindings를 사용하도록 수정했다. 제품 검증기를 완화하거나 기대값·고정 원본 fixture를 변경하지 않았다. 재실행 결과 20/20 통과이며 선택 14단계, 전체 문서의 저장 시점·Undo/Redo, 새 앱 staging, 참조 이미지 계산을 포함한다. 패키지 검사 및 소스 prerequisite도 통과했다.

새 앱·Qt·BAT·브라우저 UI는 실행하지 않았다. 전체 CI·전체 테스트 통과를 뜻하지 않는다. 후속 Pages 배포 결과는 main의 Pages workflow 실행과 최종 사용자 응답에서 확인한다.
