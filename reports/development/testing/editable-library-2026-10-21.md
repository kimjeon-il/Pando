# 편집 가능한 라이브러리 구현 현황

> 보고서 ID: `UI-LIBRARY-20261021` · 상태: `implementation-partial / app-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> 조사 기준: Web/App 공통 `work/ui`, HEAD `4f35c345e0707c44e383cca027e119207f93259c` 위 미커밋 변경

## 대상과 기준일

Windows 앱 전용 자료 편집, 외부 원본 저장, 비공개 GitHub 동기화, 별도 공개 게시, 독립 경계 편집창의 로컬 구현이다. 기존 프로젝트의 시간 기능으로 확장하지 않는다. 원격 저장소 개설·비밀 설정·최초 게시는 별도 rollout 범위다.

## 구현

- AppData 외부 원본과 편집용 JSON 파일, 원자적 다중 자료 저장, 판본 비교 및 이력 보존.
- 이름·국기·존속기간·출처·경계 버전 편집, 실행 취소/다시 실행, 자료 생성·삭제.
- 기존 C++ 편집기를 별도 창에서 재사용하는 경계 편집. 원래 프로젝트 파일/자동 저장 경로와 분리.
- 기존 gh 인증을 쓰는 동기화, 오프라인 보존, 충돌 선택, 검증 전 원격 후보 격리.
- 앱 빌드와 분리된 자료 게시 workflow 및 공개 판본 선택. 저장은 공개 게시를 실행하지 않는다.
- 원본 형상/기간 수정 시 역사 검증 표기를 잠정 상태로 낮춘다. 독립 역사 형상의 0.5 CSS px 검증을 수행했다고 주장하지 않는다.

## 실행한 검사와 한계

| 범위 | 기록된 결과 | 근거 |
| --- | --- | --- |
| JS 및 실제 Node/WASM 경계 | 51 통과, 0 실패 | `build-native/editable-library-all-units.log` |
| 브라우저 편집 UI 구성요소 | 5 통과 | `build-native/editable-library-browser.log` |
| 네이티브 저장소 실행 파일 | 22 통과 | `build-native/editable-library-native.log` |
| 변경 JS ESLint | 통과, 마지막 경고 문구 변경 이후 전체 재실행 없음 | `build-native/editable-library-eslint.log` |
| 전체 앱 Cargo 빌드 | 실패: 의존성 crc32fast 빌드 스크립트의 gcc 실행 os error 483, 캐시 I/O 1034 | `build-native/editable-library-cargo-final.log` |
| 실제 WebView 창·사용자 동선 | 미검증 | 실행 가능한 최종 앱 빌드 미확보 |
| 원격 동기화·Actions·배포·실제 공개 판본 | 미실행 | 원격 rollout 수행 안 함 |

브라우저 검사는 명시적 테스트 저장소를 주입한 구성요소 검사이며 실제 네이티브 앱 증거가 아니다. 네이티브 테스트 실행은 Cargo 전체 빌드 성공을 뜻하지 않는다. 게시 코드 검토의 네 가지 지적은 수정되었으나 최종 독립 재검토는 미완료다. [초기 편집/네이티브 검토](editable-library-editor-native-review-2026-10-21.md), [게시 검토](editable-library-publication-review-2026-10-21.md)를 함께 참조한다.

## 남은 작업

사용자가 사용량 증가를 지적한 뒤 추가 조사·반복 검사를 중단했다. 생성 중이던 자료 파생물은 담당 작업의 종료 상태를 SDD ledger에 남긴다. 최종 build metadata/immutable Worker 생성, 최종 full-world stage 검사, 앱 빌드 문제 해결 및 실제 WebView 확인이 남아 있다. 따라서 현재 변경을 실행·게시 가능한 완성본으로 주장하지 않는다.

이웃 경계 버전의 유효 기간이 다르면 저장을 거부한다. 자동 기간 분할은 구현하지 않았으며 자료 편집에서 버전 기간을 먼저 맞춰야 한다.

원격 rollout에는 `kimjeon-il/Pando-library-data`의 초기 커밋, 기존 gh 인증, `PANDO_LIBRARY_READ_TOKEN`, 공개 `library-data` 배포 브랜치 및 main에 통합된 workflow가 필요하다. 이번 작업에서 원격 생성·푸시·main 병합·배포는 하지 않았다.

## 보존

작업 전부터 존재하던 삭제 테스트 873개, 생성 권한 파일 수정 6개 및 생성 산출물을 보존했다. 작업 변경은 영구 `work/ui` 작업트리에 남겼으며 커밋하지 않았다.
