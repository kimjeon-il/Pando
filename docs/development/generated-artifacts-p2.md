# P2/P7 — 생성물 입력 그래프와 원격 게시

공통 C++ 빌드는 루트 CMake 프리셋을 사용한다. 생성물의 정본 입력·생성기·검증기·소비 위치는 `config/generated-artifacts.json`에 기록한다. 기존 계열별 manifest는 유지한다.

## 소유권과 도구

| 계열 | 실행 경로 | 도구 |
| --- | --- | --- |
| 공통 C++ → WASM | `pando-wasm` → `tools/package-shared-core-assets.mjs` | 원격 Emscripten, CMake; 게시용 Node |
| 영토·현재 세계·역사 세계 | 그래프에 연결한 기존 생성기 | Node 및 동일 C++ WASM |
| 국가 메시·미리보기·공유 경계·준비 메시 | 기존 생성기와 바이트/디코더 검증 | Node, 필요한 웹 패키지 |
| 지명 | 기존 생성기 | Node; 웹 산출물을 앱에서 staging |
| 수계·지형 원본 가공 | 명시적인 GIS 데이터 작업 | 원본 출처·버전·해시 필요; 일반 개발에서 Python 설치/다운로드 없음 |


## 계획과 실행

`.github/workflows/generated-artifacts-p2.yml`은 `work/ui`, `work/objects`, `work/gis`, `work/places`에서 실제 입력 지문을 비교한다. 브랜치 이름으로 계열을 제한하지 않는다.

- `auto`: 입력·생성기·도구·의존 출력 지문이 바뀐 계열과 하위 계열만 생성.
- `wasm`: WASM만 생성.
- `all`: 일반 계열을 명시적으로 재생성. 수동 GIS 원본 가공은 포함하지 않음.
- `verify`: 기존 출력의 지문·해시 및 실제 계열 검증기를 실행. 생성·커밋·푸시하지 않음.

검사 없이 계획만 읽기:

```sh
node scripts/p2-artifact-plan.mjs
```

수동 원격 생성:

```sh
gh workflow run generated-artifacts-p2.yml --ref work/objects -f scope=auto
```

출력 영수증은 `assets/data/generated-artifacts/p2-manifest.json`이다. 일반 원본이 없으면 해당 계열은 차단 사유를 출력한다. 원본을 임의 다운로드하거나 대체하지 않는다. 수계·지형의 별도 외부 원본 매핑이 없는 작업은 수동 차단 상태로 남는다.

## 게시 트랜잭션

1. 원격 시작 SHA와 로컬 HEAD를 확인한다. 미커밋 변경이 있으면 staging을 거부한다.
2. 검증한 WASM을 로컬 커밋한다. 원격에는 아직 반영하지 않는다.
3. 추적된 소스만 `build-native/p2/`의 임시 출력 위치에 복사한다. 선택한 기존 생성기와 검증기를 실행하고 선언된 출력 밖의 변경을 거부한다.
4. 모든 선택 출력 검증 후 게시한다. 중간 실패 시 백업 바이트를 복원한다. manifest는 마지막에 게시한다.
5. 검증된 웹 출력을 한 번의 원자적 staging으로 반영하고 로컬 커밋한다. 별도 앱 미러 단계는 없다.
6. 시작 이후 원격 브랜치가 바뀌지 않았는지 다시 확인하고 최종 결과를 일반 fast-forward push 한 번으로 반영한다. 강제 push, stash, reset, clean은 사용하지 않는다.
7. 실제 최종 결과 SHA의 커밋된 바이트와 입력 지문을 evidence artifact에 연결한다. 바이트와 지문이 같으면 재생성·복사·커밋하지 않는다.

정상 자동 소스 push의 검증은 P3가 최종 결과 SHA에서 수행한다. 원본 push 때 오래된 WASM으로 P3를 먼저 실행하지 않는다. 구현 중 수동 생성과 P9 최종 검증의 구체적 실행 범위는 workflow 입력으로 구분한다.

## 검증 상태

이 문서는 실행 계약이다. 구현 여부와 실제 실행 증거, 미검증 항목은 `reports/development/performance/p6-p9-execution-2026-10-16.md`에 기록한다. 그래프 등록만으로 실제 자산 재생성·앱/웹 동등성·성능 통과를 뜻하지 않는다.
