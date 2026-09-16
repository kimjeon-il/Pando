# 객체 강조 통합: 구현과 검증

## 구현

- `map-interaction-style.js`의 역할·우선순위·스타일을 국가, 하위단위, 일반 객체, 수계, 라벨과 편집 표시에서 공유한다. 선택색 C와 채우기 S를 사용하며, S=0과 선택 윤곽선 끄기를 유지한다. 직접 조작점·초안선과 후보 안내선은 별도로 유지한다.
- 도구별 강조색, CSS 색을 읽어 GPU 역할을 추론하는 경로, 국가 전용 중복 강조 경로를 제거했다. 실제 객체 색과 경고 구간의 의미색은 유지한다.
- 같은 객체의 역할을 먼저 합치고 편집 대상/채택 결과, 주 선택, 보조 선택, 호버, 후보 순으로 최종 표시를 정한다. 동급 공유 경계는 조상 우선, 나머지는 객체 키로 결정한다.
- Worker에서 공유 경계 구간을 준비하고 형상 참조에 묶어 재사용한다. ID로 동기화된 형상을 읽으며, 준비되지 않은 전체 외곽선을 중복 대체 표시하지 않는다.
- WebGL 강조 전용 스텐실 타깃, Canvas 재사용 마스크, SVG 우선순위 마스크로 겹친 채우기의 누적을 막는다. 물 마스크를 제외한다. 중립 보조선은 강조선 바깥에만 남긴다.
- GPU 부분 준비 시 강조 채우기 전체의 소유 경로를 전환하고 선은 항목별 준비 여부로 인계한다. GPU 채우기 합성 실패도 SVG에 돌려준다.
- 지도/목록 호버 출처를 구분해 늦은 leave가 다른 호버를 지우지 않도록 했다. 라벨 문자·국기를 재색칠하지 않고 별도 표식을 사용한다.
- 직접 드래그 미리보기도 공통 스타일을 읽고 GPU 업로드 대기 및 Canvas에서는 같은 임시 SVG 선을 사용한다. 경계 준비 완료 시 편집 패킷 갱신과 조작점 포인터 입력 연결도 보완했다.
- Canvas에서 기존 국가 원본, 카메라 투영, 실제 캔버스 크기와 표시 리비전이 서로 어긋나던 경로를 수정했다. 스타일 변경에는 좌표 배열을 다시 보내지 않는다.

선택 의미, 편집 권한, 원본 좌표, 프로젝트 저장 필드는 변경하지 않았다. 기존 미커밋 성능 개선을 보존했고 커밋·푸시·배포는 하지 않았다.

## 집중 검사

Node 실행 파일은 설치된 Codex Node 런타임을 사용했다. 아래는 해당 파일들을 명시한 실행 명령이다.

```text
node --test tests/unit/interaction-roles.test.mjs tests/unit/map-interaction-style.test.mjs tests/unit/selection-domain.test.mjs tests/unit/selection-emphasis.test.mjs tests/unit/gpu-stroke-renderer.test.mjs tests/unit/editing-render-packet.test.mjs tests/unit/map-render-coordinator.test.mjs tests/unit/user-preferences.test.mjs tests/unit/render-scene.test.mjs tests/unit/territorial-highlight-boundary.test.mjs tests/unit/edit-preview-controller.test.mjs
node --test tests/unit/boundary-preparation-session.test.mjs
node scripts/check-worker-architecture.mjs
node scripts/check-command-architecture.mjs
```

- 단위 검사 72개와 경계 준비 세션 검사 5개 통과. 변경된 표시·Worker·연결 파일 및 관련 테스트만 ESLint 검사했다.
- Chromium의 `tests/browser/interaction-unification.spec.mjs`는 변경과 실패에 연결된 이름만 `--grep`으로 재실행했다. 전체 테스트 묶음을 반복 실행하지 않았다.
- 통과 확인: Canvas/SVG 겹친 면·구멍·물 마스크 픽셀, 사용자 지정색 및 채우기 0, 중부 유럽 인접 국가 다중 선택과 목록 호버, 러시아 부모/자식 WebGL2·WebGL1·Canvas, 어두운 테마/윤곽선 끄기, GPU 컨텍스트 손실→SVG→복구, WebGL2·Canvas 해안선 드래그 임시선과 종료.
- 기존 `russia-edit-preparation.spec.mjs --grep "detailed line preparation"`의 러시아 경계 그리기·분할 미리보기·취소 검사도 통과했다.

## 러시아 결과와 검증 한계

- 실제 로딩된 러시아 상세 형상이 214개 Polygon인지 검사했다. UI로 자식을 생성한 뒤 부모와 함께 선택하여 내부 픽셀을 비교했다.
- WebGL2/1 비교 픽셀은 각각 단일/중첩 상태 모두 `[175,183,190,255]`, Canvas는 모두 `[188,196,203,255]`였다. 렌더러 사이의 색 일치를 주장하는 값이 아니라 각 렌더러 내부의 중복 합성 비교다. 허용 오차는 채널당 2/255이다.
- Canvas 러시아 픽셀 검사는 지형을 끈 조건이다. 물 제외는 Canvas/SVG 합성 fixture로 확인했으며 실제 지도 수계 전체의 픽셀 동일성 검사를 대체하지 않는다.
- 준비된 선택 객체의 반복 목록 호버에서는 강조 준비 Worker 요청 수와 GPU 선택 버퍼 생성 수가 증가하지 않았다. 모든 도형 분석·전송·메시 경로의 전면 계측이나 전후 성능 벤치마크는 수행하지 않았다.
- 모바일·키보드 전체 조합, 모든 추가/편입/합병 도구, 모든 수계/라벨/잠금 조합, 중첩 자손 전체 깊이, WebGL1 전체 편집 시나리오, 모든 지연/실패/Undo 조합은 아직 화면 검증하지 않았다.
- 따라서 대표 경로의 구현·집중 검사 결과이며, 계획의 전체 화면 완료 기준을 모두 검증했다고 보지 않는다.
