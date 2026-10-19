# 공통 지도 변경 배포와 작업 브랜치 통합

> 보고서 ID: `UI-RELEASE-SYNC-20261020` · 상태: `pages-content-verified / histories-integrated / ci-failures-recorded / native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 조사 기준: 구현 `edfd2a394f30`, 플랫폼 독립 생성 수정 `f761825cb342`, 브랜치 통합 `a4bbd1161803`, 원격 생성물 병합 `4da0a5e0353d`
>
> 원문 최종 수정: 2026-10-20 · [검증 근거](shared-viewing-release-sync-2026-10-20.evidence.json)

## 대상과 기준일

사용자의 커밋·push·배포·다른 작업 브랜치 전파 요청과, 각 브랜치가 main보다 앞선 커밋도 모두 통합하라는 후속 요청을 처리했다. 기존 조사·편집 작업은 미커밋 상태로 보존한다. UI 재설계, 지도 형상 변경, 네이티브 내부 수정은 하지 않았다.

## 근거와 방법

상설 워크트리와 원격 상태를 확인하고 검증된 UI 커밋 7개를 main에 fast-forward했다. 최초 Linux Pages staging은 물리 육지 gzip의 OS 헤더 차이로 실패했다. Windows 정본의 헤더 값 10을 생성기에서 고정하고, OS 값 3·10·255를 모의한 회귀 검사의 실패→성공을 확인했다. 기존 압축 자산·manifest·지도 좌표는 바뀌지 않았다.

Pages [39332711936](https://github.com/kimjeon-il/Pando/actions/runs/39332711936)는 `f761825cb3426ae47a69e967ba891822f44dcf91`에서 build·deploy에 성공했다. 공개 HTML·메타데이터·웹 배포에 포함된 Worker 의존성 90개와 물리 mesh를 실제 HTTP 응답으로 대조했다. 메타데이터의 앱 전용 Worker 목록은 웹 staging 목록과 교차해 검사하며, 웹에 없는 편집 자산을 배포 누락으로 취급하지 않는다.

Microsoft Edge 1280×800의 실제 Canvas Worker 경로에서 준비 완료 후 객체 수 254→5→254, 시점 왕복, 고유 색상 OFF, 문서 snapshot·dirty·Undo/Redo 불변, 내용 해시 Worker URL, console/page 오류 없음을 확인했다. 초기 미완료 상태를 기준으로 삼은 임시 probe의 불일치는 버리고 실제 `data-ready=true`를 기준으로 다시 확인했다. 이 공개 화면 검사는 개인 사용자의 기존 탭 캐시를 직접 검사했다는 증거가 아니다.

## 브랜치 통합과 미완성 작업 보존

| 대상 | 통합 내용 |
| --- | --- |
| work/objects | 고유 생성물 커밋의 최종 파일 내용은 이미 main과 같았다. 이력은 병합 커밋 `e3bfa85f`로 보존했다. |
| work/gis | 원격의 추가 2커밋을 포함해 조사 보고서·진행기록·색인 9개 파일을 `606bd4cc`로 병합했다. 지도 자료 적용으로 해석하지 않는다. |
| work/places | 고유 생성물 커밋의 최종 파일 내용은 이미 main과 같았다. 이력을 `6d767886`로 병합했다. |
| work/ui | 통합본을 가져오고 검사 수집 설정을 수정했다. push 중 발견한 bot 커밋 `1daec784`도 `4da0a5e0`에서 병합했다. 빌드 식별자만 `0.36.0-build-f761825cb342`로 갱신되고 data revision은 유지된다. |

첫 통합 기준 `a4bbd1161803f37d7c11bb2ed538e4a56cee2cd6`에서는 main과 네 작업 브랜치의 로컬 HEAD가 일치했다. 원격 bot 커밋을 포함한 후속 생성물·이 보고서도 동일한 fast-forward 절차로 전파한다. 최종 원격 push와 Pages 결과는 해당 최종 커밋의 Actions·원격 ref를 별도로 확인하며, 이 문서의 과거 배포 SHA를 최종 커밋 SHA로 바꿔 주장하지 않는다.

통합 전후 바이트 해시를 비교했다. main 1개, UI 1,327개, places 3개 작업 파일은 전부 동일했다. objects는 11개 중 10개가 동일하며 나머지 `reports/README.md`에는 새 정본 색인과 기존 미커밋 `PERF-PREDICATE-20261018` 행을 함께 유지했다. `.gitattributes`, 비교 실험 코드·자료·보고서와 미추적 증거는 보존했다. 겹친 색인은 별도 원본 복사·patch를 남기고 재적용했으며 stash·reset·clean·WIP 커밋·강제 push는 사용하지 않았다.

## 확인 결과와 한계

| 검증 | 실제 결과 |
| --- | --- |
| 기존 관련 단위 검사 재실행 | 51/51 통과 |
| gzip 회귀·build metadata | 3/3 통과, 관련 lint 통과 |
| 생성 메타데이터 | 원격 bot 생성물 병합 후에도 `--check` 통과 |
| 공개 사이트 응답 | HTML 200, Worker 90개 HTTP 200 및 SHA 일치, 물리 mesh 19,388,644 bytes 및 SHA 일치 |
| 공개 Edge Canvas 화면 | 시점 왕복·고유 색상 토글·문서 불변·버전 Worker·오류 없음 통과 |
| 로컬 Canvas/WebGL2·편집 생성 | 이전 구현 검증의 실제 브라우저 3개 통과. [수정 검증 보고서](port-mesh-worker-fixes-2026-10-20.md)에 범위를 구분함 |
| Web/App staging | 앞선 검증 및 원격 Application 실행에서 웹 1,399개, 앱 full-world 1,720개 확인. 네이티브 실행 증거와 구분 |
| 브라우저 검사 수집 | describe 내부 `trace` 설정 오류를 재현하고 파일 최상위로 이동. 관련 4개와 전체 수집 414개/151파일 성공. 전체 실행 통과를 뜻하지 않음 |

전체 CI 성공으로 보고하지 않는다. Application run [39332711883](https://github.com/kimjeon-il/Pando/actions/runs/39332711883)의 수집 오류는 수정했지만 모든 브라우저 동작을 다시 실행하지 않았다. 별도 [C++ contracts run](https://github.com/kimjeon-il/Pando/actions/runs/39332402155)은 9개 중 2개 실패(opaque baseline 누락·territorial golden 불일치), [terrain preview run](https://github.com/kimjeon-il/Pando/actions/runs/39332402263)은 실제 표시 기대값 3개 실패를 기록했다. 이 통합 작업은 해당 실패를 해결했다거나 현재 제품의 독립적인 회귀가 아니라고 단정하지 않는다.

Windows 네이티브 UI·Android 기기, 최종 통합 후 모든 편집 흐름, 개인 사용자의 기존 HTTP 캐시는 미검증이다. WebGL 공개 사이트 전체 재검증은 수행하지 않았으며 로컬 구현 검증을 대신 게시 검증이라고 표시하지 않는다. 역사 형상·0.5 CSS px 검증은 대상이 아니다.

## 데이터 반영과 판본

지도 데이터 반영은 `not-applicable`이다. 과거 로컬 검증 기록은 그대로 두고 [공통 열람 정리](shared-viewing-cleanup-2026-10-19.md), [검사 자동화](check-automation-2026-10-19.md), [포트·Worker 수정](port-mesh-worker-fixes-2026-10-20.md)의 배포 후속 근거를 이 문서에 모았다. 배포·브랜치 통합·파일 보존·CI 실패는 각각의 증거로 판단한다.
