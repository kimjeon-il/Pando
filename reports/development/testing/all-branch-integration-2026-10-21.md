# 10월 21일 작업 브랜치의 main 통합

> 보고서 ID: `DEV-ALL-BRANCH-20261021` · 상태: `integrated / focused-verified / local-only` · 지도 반영: `not-applicable` · 색인일: 2026-10-21
> 원문 최종 수정: 2026-10-21
> 기준: 통합 전 main·origin/main `f9197bd6cfdcb2824c4de0799e7308b3efd6a360`; 원격 fetch 후 아래 고정 참조를 통합
> 근거: main 워크트리의 ignored `.superpowers/sdd/all-branch-integration-20261021/`

## 범위와 통합

사용자는 다른 수정사항도 함께 main에 전부 병합하도록 요청했다. 모든 로컬·origin 브랜치의 main 미포함 커밋과 상설 워크트리 상태를 조사했다. 미커밋 실험·대량 테스트 삭제·생성물은 확정된 커밋에 섞지 않았다.

| 참조 | main 미포함 커밋 | 반영 내용 |
| --- | ---: | --- |
| `work/ui` `955134d4` | 2 | 초기 지도·프로젝트 교체 표시 연속성, 형상 중복 복사 제거, 웹 지구본 전용 |
| `origin/work/ui` `0ce82bbd` | 2 | 편집 작업과 삭제 동작의 고정 DOM 위치, 관련 UI 검사·생성물 |
| `work/objects`, `origin/work/objects` `bc3b5044` | 4 | C++ fixture 2건, Windows D3D11 WebGL 검사, 소스 일치 WASM·연결 생성물과 검증 기록 |
| `work/gis`, `work/places`와 각 원격, 원격 reference-image 브랜치 | 0 | 이미 main에 포함 |

main을 `955134d4`로 fast-forward한 뒤 원격 UI를 `63dcdb2a`, objects를 `b82c8ea5`로 병합했다. 제품 원본에는 충돌이 없었다. 생성된 HTML·build metadata와 P2 receipt에만 충돌이 있어 원본을 합친 뒤 기존 생성기로 다시 만들었다. receipt는 family별 변경을 결합하고 통합본의 필요한 generator/validator와 기존 P2 지문 계산으로 갱신했다. 마지막 fetch 후 모든 로컬·origin 브랜치 끝점이 main의 조상이고 미포함 커밋 수가 0임을 확인했다.

형상 저장소 성능 수정이 generator closure에도 포함돼 territorial/current-world/historical-world/prepared-mesh의 입력 지문이 바뀌었다. 해당 네 생성기와 검증을 실제 실행했다. 이 과정에서 역사 프로젝트 gzip의 OS 헤더가 Linux 3, Windows 10으로 달라진다는 기존 생성기 문제를 재현했다. 차이는 압축 파일의 9번 바이트 하나였고, 압축 해제한 JSON 바이트·프로젝트·형상은 동일했다. `8c0c9bb4`에서 기존 게시 형식인 OS 헤더 3을 생성기에 고정하고 회귀 assertion을 추가했다. 수정 후 정본을 대상으로 역사 생성기의 `--check`가 통과했고, prepared-mesh 입력·메시도 실제 decoder로 다시 검사했다. 기존 게시 자료의 바이트를 유지하므로 지도 형상 변경은 없다.

메타데이터 receipt 계산에서는 내용이 바뀌지 않은 README를 기존 Git 정본의 LF 바이트로 맞췄다. 폐기된 `native/assets/place/`를 가리키던 `native-assets` receipt 항목은 현재 생성물 그래프에 없는 항목이므로 제거했다. 원본 자료나 앱 파일을 삭제한 것이 아니며 이전 receipt는 Git과 실행 근거에 보존한다.

## 검증

- 관련 단위 검사 39/39 통과(약 0.90초): 지도 표시 연속성·지구본 정책·읽기 모델·고정 편집 작업/삭제 위치·생성 HTML.
- C++ `web_content_command_tests`, `web_territorial_command_tests` 2건 통과. merged main의 `shared/`가 objects와 동일함을 확인하고, 원래 objects 소스로 빌드한 기존 GNU 테스트 실행 파일을 해당 런타임으로 실행했다. main에서 새 CMake 빌드를 했다는 뜻이 아니다.
- 실제 Chromium/D3D11 브라우저 4/4 통과(약 1분 18초): 편집 작업/삭제 UI의 고정 DOM과 반응형 작업 패널, 새 프로젝트 대기·크기 변경·빈 지도 전환, 국가/이미지 지연 중 첫 바다·육지 표시, 웹 파일 열기·검색·초기화·카메라 복원·모바일 회전/터치 확대. 모두 통합된 main을 제공하는 서버에서 실행했다. 편집 HTML의 브라우저 실행이며 실제 WebView 실행 검증과 구분한다.
- 공통 WASM의 ABI·컴파일러·현재 소스 pin·게시 JS/WASM 바이트 검사 통과. 소스 SHA는 `c05f2987…`, WASM은 `c83a34a0…`다.
- 수정 gzip 생성기/회귀 assertion ESLint, `generate-build-metadata --check`, `check-version`, 실제 prepared-mesh decode와 모든 비수동 P2 family의 입력·출력 지문 일치 확인 통과. 빌드 ID는 `0.36.0-build-8c0c9bb4efc7`이다. 게시용 viewer의 의존성 closure도 해석했다. Pages 파일 복사·업로드·배포 검증은 아니다.

별도 알려진 CI 실패: objects 보고서의 Linux WASM 재빌드 바이트 재현성 실패는 이번 병합으로 해결했다고 표시하지 않는다. 해당 보고서의 이전 실행 결과와 이번 로컬 실행을 구분한다.

## 보존한 작업과 한계

UI의 테스트 삭제 873건·생성 권한 6건·미추적 파일, objects의 predicate 비교 도구/보고서·`.gitattributes` 변경, places의 label anchor·생성 자료, main의 `reports/annex-reproduction-20261015.png`는 병합 대상에서 제외했다. UI·objects·places의 전후 상태 항목 차이는 0개이고 GIS는 계속 깨끗하다. 모든 미추적 파일의 바이트 해시를 검사했다는 주장은 하지 않는다. 상설 브랜치와 워크트리를 유지하고 stash·reset·clean·강제 push를 사용하지 않았다.

중간 Git 작업 뒤 프로세스가 없는 0바이트 `index.lock`이 남아 진행이 막혔다. 실행 중인 Git이 없고 대상 경로가 main의 `.git/index.lock`임을 확인한 뒤 ignored 작업 폴더에 옮겨 보존했다. 기본 Git fsync 오류 회피는 명령별 옵션에만 적용하며 사용자 Git 설정을 바꾸지 않았다. 메타데이터 쓰기 한 번의 일시적 파일 열기 오류도 후속 정상 재생성·검증과 구분해 원시 로그에 남겼다.

전체 회귀·C++ 전체 CI·Windows 앱 재빌드/실행 파일 교체·실제 WebView/Android·실제 사용자 검증은 이번에 실행하지 않는다. 원격 push·Pages 배포도 이번 로컬 병합 범위에 포함하지 않는다. main push가 Pages workflow를 시작하므로 병합과 게시를 구분한다.

게시 후속 기록: [DEV-INTEGRATED-RELEASE-20261021](integrated-release-2026-10-21.md). 당시 검증 범위는 위 기록대로 유지하며, 이후 main push·Pages·실제 Windows 실행 검증은 후속 문서에서 구분한다.
