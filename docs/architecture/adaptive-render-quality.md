# 5단계: 적응형 지도 품질과 GPU 리소스 예산

## 불변 조건

- 프로젝트의 canonical GeoJSON과 편집 geometry는 단순화하지 않는다.
- snapping, topology, validation, 면적 계산, 저장과 내보내기는 항상 canonical 좌표를 사용한다.
- 공유국경, 국가 경계 편집, draft, preview, 선택 객체는 독립 객체 LOD의 대상이 아니다.
- 표시 LOD는 `RenderScene`에 들어가는 세션 전용 typed-array packet에만 적용한다.

## 품질 단계

런타임 품질은 `coarse`, `medium`, `high` 세 단계다. 초기 단계는 모바일 여부, 메모리, 논리 코어 수, Save-Data 신호로 정하고, 이후 실제 렌더 프레임의 p95/p99로만 승격하거나 강등한다. 사용자 에이전트 문자열만으로 품질을 고정하지 않는다.

품질이 낮아질 때는 다음 순서를 따른다.

1. 독립 배경 overlay LOD
2. 라벨 후보 밀도
3. terrain 해상도와 cache budget
4. backing DPR
5. 프레임별 GPU upload budget

선택 객체와 활성 편집 geometry의 정밀도는 이 순서에 포함하지 않는다.

## interaction과 settle

지도 이동이 시작되면 국가 base mesh는 preview로 전환하고 hydro/terrain upload budget을 줄인다. 기존 GPU buffer와 현재 편집 overlay는 유지한다. 입력 종료 후 120ms 동안 추가 입력이 없으면 품질 프로필이 허용하는 country mesh로 복귀하고, 독립 overlay와 라벨만 idle 작업에서 정제한다.

canonical country mesh가 준비된 뒤에도 preview mesh를 폐기하지 않는다. 선택 국가 경계는 선택된 owner ID에 해당하는 canonical segment만 별도 stroke resource로 만들므로 preview base 위에서도 고정밀로 표시한다. 선택이 없을 때 전 세계 canonical 선택 ribbon을 미리 만들지 않는다.

## 캐시와 업로드

- RenderScene CPU packet cache는 바이트 예산과 LRU를 함께 사용한다.
- polygon/stroke GPU resource cache는 visible, selected, editing resource를 보호하고 비활성 low-priority LRU부터 제거한다.
- 지속적으로 보이는 전 세계 국가 기본 경계는 이미 존재하는 mesh의 indexed line buffer를 재사용한다. 공통 stroke instance buffer는 선택·hover subset과 편집·overlay에만 사용해 세계 국경을 중복 업로드하지 않는다.
- hydro cache와 terrain texture cache는 각각 품질 프로필의 바이트 예산을 따른다.
- hydro buffer upload는 프레임별 byte budget으로 분할한다.
- terrain texture는 원자적 업로드 단위이므로 프레임별 tile 수와 시간 예산을 함께 제한한다.
- 예산보다 protected resource가 큰 경우 해당 리소스를 버리지 않고 pressure 진단값을 남긴다.

## 진단

`?perf=1`과 debug mode에서는 다음을 확인할 수 있다.

- 현재 품질 tier, phase, 변경 이유와 p95/p99
- active country mesh quality와 variant별 GPU bytes
- RenderScene packet cache bytes/eviction
- polygon/stroke GPU cache bytes/eviction/pressure
- terrain/hydro cache bytes
- label 후보 제한 수
- interaction 중 mesh switch와 settle 대기 상태

이 값은 세션 진단용이며 프로젝트 파일에는 저장하지 않는다.
