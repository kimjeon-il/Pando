# ChronoMap Editor — MVP 0.1

역사·대체역사·국가운영 시뮬레이션용 3D 지구본 지도 편집기 프로토타입입니다.

## 현재 구현된 기능

- MapLibre 기반 3D 지구본 / Mercator 평면 전환
- 세계 국가 GeoJSON 불러오기 및 국가 클릭 선택
- 국가별 국명, 지도색, 수도, 메모, 국기 이미지 등록
- 국가 레이어 / 사용자 도형 / 도시·지명 / 기본 지도 라벨 표시·숨김
- Terra Draw 기반 Point / LineString / Polygon / Rectangle / Freehand 생성
- Terra Draw Select 기반 사용자 도형 기하 편집
- 사용자 도형 메타데이터: 이름, 분류, 색상, 메모
- 도시·지명 직접 추가 및 편집·삭제
- 프로젝트 자동 저장(LocalStorage)
- 프로젝트 JSON 저장/불러오기
- 사용자 GeoJSON 가져오기/내보내기
- 속성 편집 Undo / Redo 100회
- 발칸 빠른 이동

## 실행 방법

이 앱은 빌드 과정이 없는 정적 웹앱입니다. 브라우저 보안 정책 때문에 `index.html`을 더블클릭하기보다는 로컬 HTTP 서버로 실행하는 것이 안전합니다.

### Python

```bash
cd historical-map-editor-mvp
python -m http.server 8080
```

그 다음 브라우저에서:

```text
http://localhost:8080
```

### Node.js

```bash
npx serve .
```

## 인터넷 연결

현재 MVP는 다음 리소스를 인터넷에서 불러옵니다.

- MapLibre GL JS
- Terra Draw MapLibre control
- OpenFreeMap 기본 지도 스타일
- 공개 세계 국가 GeoJSON

향후 오프라인 패키징 단계에서는 모두 로컬 파일/PMTiles로 전환할 수 있습니다.

## 조작

1. 국가 클릭 → 오른쪽 속성 패널에서 국명/색상/수도/국기 수정
2. 지도 왼쪽 위 Terra Draw `Polygon` → 사용자 영역 생성
3. Terra Draw `Select` → 생성한 도형 꼭짓점 편집
4. 왼쪽 `지명 추가` → 지도 클릭 → 이름 입력
5. 상단 `프로젝트 저장` → `.chronomap.json` 파일로 저장
6. `GeoJSON 가져오기` → Point/LineString/Polygon 데이터 불러오기

## MVP 한계

- 기본 국가 경계 자체를 Terra Draw로 직접 수정하는 기능은 아직 분리되어 있습니다. 현재 기본 국가 GeoJSON은 색상/속성 편집 대상이고, 사용자 경계는 Terra Draw에서 별도로 작성합니다.
- 공유 국경 토폴로지, 국가 폴리곤 분할/병합, 영토 양도, 브러시 기반 민족분포 셀은 2차 단계입니다.
- 사용자 도형의 `분류색`은 현재 메타데이터로 저장되며 Terra Draw의 편집 스타일을 완전히 대체하지는 않습니다.
- 수십만~수백만 셀은 GeoJSON 대신 PMTiles/벡터타일 구조로 전환해야 합니다.

## 데이터 포맷

프로젝트 파일은 대략 다음 구조입니다.

```json
{
  "format": "chronomap-project",
  "version": 1,
  "view": {},
  "layerVisibility": {},
  "countryOverrides": {},
  "labels": [],
  "drawingMeta": {},
  "drawings": []
}
```

## 다음 개발 우선순위

1. 기본 국가 경계를 편집 가능한 토폴로지 데이터로 변환
2. 공유 국경(shared border) 편집
3. 폴리곤 분할/병합 및 영토 양도
4. 사용자 도형 스타일을 지도에 데이터 기반으로 직접 렌더링
5. 민족/언어/종교 브러시 레이어
6. 고밀도 셀 및 대규모 데이터용 PMTiles
7. 타임라인·역사 이벤트·세계선 분기
8. 국가운영 시뮬레이션 세이브 연동
