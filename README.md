# AtlasWright v0.9.0

국가와 국경을 만드는 세계지도 편집기입니다. Natural Earth 5.1.1의 1:10m 국가 데이터를 사용하며, 빌드 과정 없이 정적 서버나 GitHub Pages에서 실행됩니다.

## 로컬 실행

이 프로젝트는 Worker와 외부 데이터 파일을 사용하므로 `index.html`을 직접 더블클릭하지 마세요.

프로젝트 폴더에서 다음 중 하나를 실행한 뒤 브라우저에서 표시된 주소를 여세요.

```powershell
python -m http.server 8080
```

접속 주소: `http://localhost:8080/`

## GitHub Pages

1. 이 폴더의 내용을 GitHub 저장소에 올립니다.
2. 저장소의 **Settings → Pages**에서 배포할 브랜치와 루트 폴더를 선택합니다.
3. 생성된 Pages 주소로 접속합니다.

모든 파일 경로는 저장소 하위 주소에서도 동작하도록 상대경로로 구성되어 있습니다.

## 데이터와 호환성

- Natural Earth 5.1.1 Admin 0 Countries, 1:10m
- 258개 국가·속령·분쟁 단위
- 원본 좌표 548,471개
- 기존 ChronoMap v0.8.19 프로젝트와 GeoJSON 불러오기 호환
- 기존 자동저장 IndexedDB·localStorage 식별자 유지

Natural Earth 데이터는 퍼블릭 도메인입니다.
