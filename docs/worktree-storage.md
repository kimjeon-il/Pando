# 상설 작업트리 저장공간

상설 작업트리의 편집 가능한 소스는 독립적으로 유지한다. 저장공간·삭제 권한의 정본은 [AGENTS.md](../AGENTS.md#storage-and-generated-file-cleanup-mandatory)이며, [브랜치 정책](branch-policy.md)과 [현재 구조](workspace-layout.md)를 함께 따른다. Web Viewer가 유일한 제품이며 퇴역 Windows/Qt/Android 앱 staging을 다시 생성하거나 공유하는 API는 제공하지 않는다.

## 현재 저장 소유자

- `tools/data/worktree-storage.mjs`는 의존성 준비, 불변 frontend/native artifact view와 blob 정리를 담당한다. library 원문과 자료 blob은 library-data 소유다.
- 공통 Git의 `pando-storage.json`이 저장공간 위치와 로컬 compiler 비활성화를 결정한다. 기존 공유 도구·GPU Python·GIS·ADB 환경은 보존한다.
- `node_modules`는 작업트리별 링크를 유지한다. `pnpm deps:prepare`는 고정 pnpm 버전과 공유 store를 사용하며 패키지 원문을 직접 수정하지 않는다.
- `.library-data/frontend-artifacts.json`, `native-artifacts.json`, 실행 lease와 작업트리 자료 pin은 현재 소비자를 식별한다. 링크 대상까지 재귀적으로 정리하지 않는다.

## 집중 정리 명령

실행할 작업을 명시한다. 아래 명령의 기본 동작은 미리보기이며 `--apply`가 실제 정리를 수행한다. 단독 `--apply`와 옛 `--resume` staging 명령은 지원하지 않는다.

```powershell
node tools/data/worktree-storage.mjs --prune-blobs
node tools/data/worktree-storage.mjs --retire-frontend
node tools/data/worktree-storage.mjs --retire-native
node tools/data/worktree-storage.mjs --retire-generated=requests.json --output=manifest.json
node tools/data/worktree-storage.mjs --retire-generated=manifest.json --apply --output=result.json
```

자료 준비 잠금, 실행 소비자, 활성 참조·lease와 미완료 journal을 먼저 확인한다. 수정된 파일, 소유권을 확인할 수 없는 파일, 유일한 복구 바이트는 보존한다. blob 정리는 해시·파일 ID·하드링크 수를 대조하고 미완료 저장 journal이 있으면 중단한다. 다른 작업의 잠금을 제거하지 않는다.

frontend/native 정리는 기존 manifest에 기록된 바이트만 제거하고 파일별 복구 journal로 중단된 작업을 재개한다. 새 소비자나 참조가 생기면 중단한다. 원본 자료와 소스는 제거하지 않는다. 삭제한 논리 바이트와 실제 drive 여유 공간 변화는 별도로 기록한다.

## 생성물과 증거

생성물 정리는 요청 목록과 정확한 preview manifest를 사용한다. 절대 경로·junction·파일 ID·크기·SHA-256을 확인하고 적용 직전 소비자를 다시 검사한다. 작업트리의 추적·미추적 작업은 보호한다. 고유 증거는 기존 라이브러리 소유 위치에 보관하고 바이트를 검증한 뒤 옮긴다. 종료된 재생성 출력은 별도 백업하지 않는다.

실행 중인 build, compiler, emulator와 대상 경로를 사용하는 프로세스는 정리를 차단한다. 1 GiB 이상 추가하는 작업은 재사용 가능성과 peak 추가 공간에 5 GiB 여유를 확인한다. 현행 증분 캐시는 유지한다.

과거 SDK·Qt runtime의 명시적 소유권·해시 기반 정리 기능은 기존 설치물의 안전한 철거에만 사용하며 제품 빌드·준비 경로가 아니다. 자료·평가 증거와 다른 프로젝트의 공용 도구에는 적용하지 않는다. 로컬 compiler·SDK는 설치하지 않고 native 검증은 등록된 해당 CI 검사로만 수행한다.

앱 Git 정리는 기존 객체 집합을 보존하는 새 pack을 검증하는 작업이며 refs/reflog 만료·prune·이력 재작성은 포함하지 않는다. 미완료 journal은 복구 근거로 보존한다.
