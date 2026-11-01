# GitHub 데이터 수정의 자동 생성·반영 — 비활성 준비 설계

상태: 2026-11-01 10:18:28 UTC에 즉시 알림 방식 A 준비가 승인되었다. work/gis에서 구현·검증하며 productionEnabled 기본값은 false다. 권한 생성·등록, main 설치·활성화, 공개 배포는 별도 승인 대상이며 실행하지 않았다.

## 목표
GitHub에 정본 데이터를 수정하면 필요한 생성·검증·연결·공개 사이트 갱신이 자동으로 이어진다. 사용자에게 매번 별도 ‘반영’ 버튼을 요구하지 않는다. 검증을 없애거나 작업 브랜치를 자동 공개하지 않는다.

## 현재 확인
- 자료 저장소 main/work/gis에 workflow가 없다.
- 앱의 기존 P2는 work/* 전용이며 main 생성·게시 금지는 유지한다.
- 공개 Pages는 Pando main의 config/library-data.json 판본을 사용한다.
- library.json + objects/<sha256>.json이 편집 정본이다. 해시 이름 객체만 수정하거나 index와 불일치한 변경을 자동 보정한 척하지 않고 정확한 오류로 중단한다.
- 앱의 기존 데이터 쓰기 토큰이 반대 방향의 앱 Actions 실행 권한까지 가진다는 근거는 없다.

## 선택된 방식과 복구 경로
A. 선택: 데이터 push 알림 → 앱의 고정 수신 workflow. 감지가 빠르며 GitHub 실행 대기·생성 시간은 발생한다. 데이터 저장소에서 Pando Actions를 호출할 별도 GitHub App/세분화 토큰이 필요하다. 최소 토큰 권한은 Pando 저장소 Actions:write이며 특정 workflow 하나로 제한되는 권한이라고 주장하지 않는다. 자격증명 생성·등록은 별도 명시 승인 대상이다.
복구 보조: 앱 workflow가 일정 간격으로 데이터 최신 SHA를 확인. 추가 역방향 호출 자격증명 없이 기존 데이터 접근/쓰기 인증을 재사용할 수 있으나 확인 간격·GitHub 예약 지연이 있어 즉시 반영은 아니다.

## 공통 처리 흐름
정본 변경 감지 → 허용 저장소/브랜치 및 정확 SHA 고정 → 정본 schema·hash·참조 일관성 검증 → 영향받는 공식 생성기와 필요한 의존 산출물 생성 → 결과 검증 → 완성 데이터 게시 → 대응 앱 pin 갱신 → 공개 적격 채널만 Pages 자동 호출 → 실제 사이트의 코드/데이터 SHA·자산 hash 확인.

- 자료는 입력이지 명령이 아니다. 원격 스크립트·임의 URL·임의 경로를 실행하지 않는다.
- 이벤트 payload만 믿지 않고 GitHub에서 SHA와 허용 브랜치 포함 관계·현재 HEAD를 다시 확인한다.
- 정본 fingerprint가 같으면 생성 재실행은 생략하되, 이전 연결·배포 실패가 있으면 그 미완료 단계는 재개한다.
- 보고서만 바뀐 커밋·기계 생성물만 바뀐 커밋은 새로운 정본 변경으로 보지 않는다. 기존 보고서 descriptor와 동시 작업 변경은 보존한다.
- 타임스탬프는 기록/진단용이며 신뢰·순서 판정은 SHA·조상 관계·현재 HEAD로 한다.

## 브랜치와 권한 경계
- work/gis 입력은 work/gis 검증·판본 연결까지(호스팅 미리보기 완료를 뜻하지 않는다). main 자동 병합이나 공개 배포는 하지 않는다.
- 향후 production은 명시적으로 승인한 자료/앱 main 조합에서만 작동한다. 현재 P2의 main 금지 guard는 해제하지 않는다.
- production 전용 데이터-only owner가 공식 생성 함수를 재사용하고 허용된 pin/필요 데이터 검증 fixture만 바꾼다. 다른 코드나 작업 브랜치를 자동 병합하지 않는다.
- 실제 main 설치·활성화·배포 및 자격증명 설정은 현재 작업에 포함하지 않는다. 먼저 work/gis에서 준비·검증한다.

## 트랜잭션·재개
두 저장소와 Pages는 하나의 원자적 트랜잭션이 아니다. desired source fingerprint와 마지막 실제 배포 성공의 (app SHA, data SHA, source fingerprint)를 분리해 기록한다.
1. 데이터 게시 전 실패: 기존 live pin/site 유지.
2. 데이터 게시 성공, 앱 pin 실패: 완성 데이터 SHA를 기록하고 최신 HEAD를 재검토해 연결 단계부터 재개.
3. 앱 pin 성공, Pages 실패: 동일 검증 판본 배포를 자동 재시도; ‘생성물-only event 무시’로 방치하지 않는다.
4. 동시 변경: 비강제 compare-and-swap 실패 시 현재 desired state를 다시 읽고 재조정한다. 과거 판본으로 덮어쓰지 않는다.
5. 완료 판정: Pages 응답의 실제 SHA와 hash가 목표와 일치할 때만 성공.

GITHUB_TOKEN이 만든 push는 일반 후속 workflow/Pages를 자동 시작하지 않으므로 필요한 후속 호출은 시스템이 명시적으로 dispatch한다. 이는 사용자 수동 단계가 아니다.

## 검증 계획
허용/금지 브랜치, 잘못된 SHA/hash/schema, 정본·index 불일치, 보고서-only no-op, 생성물 loop 방지, 뒤늦은 이벤트, 데이터/앱 CAS 실패, 부분 게시 후 재개, Pages 실패 재개, 이전 성공 판본 유지, production 경계, 현재 G의 날짜/양국 경계 보존을 검증한다. 실제 production 활성화 없이 work/gis에서 테스트한다.

## 보존 중인 G 작업
승인된 post-2008 RUS/CHN 입력과 공식 로컬 생성 결과는 보존했다. 기존 일회성 후보 workflow 초안은 중단 상태이며 새 자동 경로 설계를 승인했다고 자동으로 재게시하지 않는다. 원격에는 immutable blob 9개만 업로드됐고 새 commit/ref/pin/dispatch는 없다.

## 근거
- Pando docs/library-data.md (e78a2437): 편집 정본·pin·공개 정책.
- scripts/p2-publish-artifacts.mjs:18,66: work/* guard.
- .github/workflows/web-pages.yml: main push, pinned data, superseded-main guard, 실제 사이트 검증.
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event

## 초기 지원과 검증 경계
- 기존 국가의 geometry 및 관련 출처 metadata, 명시적 world view만 지원한다. 국가 추가·삭제·동일성·생애·계보·상하관계, 수계·지형·장소 등의 변경은 보존하고 명시적으로 거부한다.
- 정본 객체 수정은 새 내용의 SHA256 객체와 library/index 참조를 일관되게 갱신해야 한다. 손상된 기존 해시 경로를 자동 승인하지 않는다.
- receipt는 신뢰할 수 있는 실행 증명으로 취급하지 않는다. 아직 앱에 연결되지 않은 산출물은 공식 재생성과 전체 산출물 집합 대조를 거쳐야 한다.
- 준비 테스트의 Git/API/전체 생성 경계는 주입 대역을 사용했다. 실제 production 설치·원격 end-to-end·사이트 갱신 완료를 뜻하지 않는다.
- 신규 receiver는 향후 기본 브랜치 설치가 필요하고, 데이터 저장소의 PANDO_AUTO_DATA_NOTIFY_TOKEN에는 Pando 저장소 Actions:write 권한이 필요하다. 특정 workflow 하나로 제한되는 권한은 아니다. 토큰 설정은 이 준비에 포함되지 않는다.
