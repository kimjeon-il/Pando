# 한국·북한 정부수립일과 남북 경계 전환

2026-10-21 후속 통합: 작업 커밋 `bd68b8d4`가 사용자 지시로 로컬 main에 병합됐다. 아래 `work-gis-only` 및 미커밋 표기는 최초 검증 시점의 기록이며, 새 병합 결과를 재검증한 것으로 해석하지 않는다. [통합 기록](../development/testing/library-korea-main-merge-2026-10-21.md).

> 보고서 ID: `GEO-KOR-20261021` · 상태: `implemented-partially / provisional` · 지도 반영: `work-gis-only` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> 조사 기준: Web/App 공통 기반 커밋 `4e8cb5b117eaf1e1f1a3411e424c5139139f759f` + 이 작업의 미커밋 변경  
> 원본·출처: [원본 색인·해시·검사 상태](../../tools/historical-library/sources/korea/provenance.json)

## 대상과 기준일

- 대한민국 정부수립일 `1948-08-15`, 조선민주주의인민공화국 정부수립일 `1948-09-09`. 종료일은 각각 null이다. 국가 정체성 ID와 국기는 유지했다.
- 남북 육상 경계는 각 정부수립일부터 `1953-07-26`까지 38선, `1953-07-27`부터 정전협정 군사분계선(MDL)이다. 전쟁 중 전선 변화와 NLL은 추가하지 않았다. DMZ 남방한계선을 MDL로 오인하지 않았다.
- 북중 조약 체결 `1962-10-12`와 국경 의정서 발효 `1964-03-20`을 구분했다. 북한 버전의 1964 전환은 **근거·확정 상태의 전환 기록**이다. 확정 전 영토 이양 폴리곤을 복원했다는 뜻이 아니며, 이 날짜 전후 북한 형상은 의도적으로 같다.
- 북한의 1964 이전 북쪽 외곽은 현대 선형을 **미검증 참고 형상**으로 유지한다. 이는 합의된 역사 국경으로 확정한 것이 아니다. 북러 경계·시기별 해안선 복원·독립 해상 경계 레이어는 작업 범위 밖이다.

## 근거와 방법

| 자료 | 확인 내용·판본·권리 | 판단 |
| --- | --- | --- |
| [대한민국 정부](https://www.korea.net/Government/Constitution-and-Government/Constitution), [유엔 당시 보고서](https://digitallibrary.un.org/record/703005/files/A_575_Add-3-EN.pdf?ln=ar) | 1948-08-15, 1948-09-09 정부수립일 | 날짜 반영 |
| [정전협정 원문](https://www.archives.gov/milestone-documents/armistice-agreement-restoration-south-korean-state), [미 국무부 IBS 22](https://library.law.fsu.edu/Digital-Collections/LimitsinSeas/pdf/ibs022.pdf) | 1953-07-27 정전, 38선·MDL, 한강하구와 서해 도서 취급. IBS 22 발행 1963-05-24 | 사건·귀속 근거 대조 |
| [US DoS LSIB 11.4](https://geodata.state.gov/geonetwork/srv/api/records/3bdb81a0-c1b9-439a-a0b1-85dac30c59b2) | 발행 2025-02-24. SHP 정본, WGS84/EPSG:4326. 제공자의 내부 ZIP SHA-256과 실제 다운로드 일치. 원본 속성·좌표를 유지한 한국 관련 4개 선 추출. 원본 저작권 고지와 메타데이터 보존 | 현대 벡터 후보·국지 반영, 시대별 독립 형상 검증 아님 |
| [CShapes](https://icr.ethz.ch/data/cshapes/) | 역사 벡터 후보. CC BY-NC-SA 4.0, 이번 제품 형상에 사용하지 않음 | source-indexed |
| [IBS 17, 1962-06-29](https://library.law.fsu.edu/Digital-Collections/LimitsinSeas/pdf/ibs017.pdf) | 1958 북한 지도와 1934 Ting Atlas·중국 지도의 백두산 선형 불일치를 명시. 미 연방정부 원 지도는 저장·열람 | pre-settlement geometry unresolved |
| [북중 경계 원자료 연구](https://www.cuhk.edu.hk/ics/21c/media/articles/c124-201103001.pdf), [1964 의정서 전사본](https://zh.wikisource.org/wiki/中华人民共和国政府和朝鲜民主主义人民共和国政府关于中朝边界的议定书), [1959 지도집 원자료 연구](https://doi.org/10.22776/kgs.2023.58.6.672) | 조약·의정서 날짜와 천지 서북부 중국/동남부 북한 귀속, 역사 지도상 주장과 순찰선·관할구역의 차이. 전사본을 서명 원본·부속도 전체 확보로 간주하지 않음 | source-indexed; 확정 전 영토 차이 보류 |

원본 AMS 1:250,000 NK52-5·NK52-8 지도도 열람했다. 발행·수정 연혁과 표기된 선형을 살폈지만, 이 지도를 독립적으로 정합·벡터화한 마스터는 만들지 않았다. 따라서 해당 지도를 근거로 정밀한 확정 전 국경을 제품에 새로 그리지 않았다.

실제 연산은 기존 공통 C++ WASM의 polygonOperation과 winding normalizer가 담당한다. 소스 생성기는 고정된 원본을 조합하며, 별도 형상 엔진·렌더러·프로젝트 시간 UI를 추가하지 않았다.

## 확인 결과와 한계

- 최대 배율 기준은 `flatZoom=64`, 지도 콘텐츠 너비 `2560 CSS px`, 허용 편차 `0.5 CSS px`이다. 각도 기준 약 `0.00109863°`에 해당한다. 이 기준에서 차이가 보이는 천지 주변과 남북 MDL을 우선했다. 개별 표석·미세 굴곡 및 전 하천의 작은 사주를 별도로 추적하지 않았다.
- 현대 LSIB에서 **PRK–KOR / Other Line of International Separation**을 선택했다. 별도의 **KOR–KOR / Special Line**은 DMZ 남방한계선이므로 사용하지 않았다. 기존 한강하구 취급을 유지했다.
- 기존 한국·북한의 공유 육상 경계와 백두산 인접 북중 경계만 교체했다. 중국의 다른 경계나 역사 가용기간은 확장하지 않았다. 현재 한국·북한·중국의 합집합은 원본과 같으며, 귀속 중복이 없다.
- 38선 전환은 본토를 대상으로 한다. 백령도를 포함한 한국 도서 성분을 38선으로 잘라 섬 일부를 북한으로 넘기는 오류를 회귀 검사로 막았다. 북쪽 현대 원본에서 38선 남쪽에 완전히 놓인 도서는 정전 이전 남쪽에 배정한다. 개별 도서의 시대별 원도 대조는 미완료다.
- 현대 Natural Earth 해안선·도서 윤곽과 외곽의 나머지 구간은 유지했다. LSIB 원본 자체도 현대 자료다. **독립 시대별 MDL/북중 마스터 형상 및 해안 접속부의 0.5 CSS px 검사: 미실행.** 전체 형상을 historically-verified 또는 screen-delta-checked로 승격하지 않았다.
- 북중 확정 전 선형과 영토 차이, 압록강·두만강 전체의 1964 도서·사주 목록 대조는 미완료다. 천지 북서/남동의 현재 귀속은 검사했지만, 이것으로 1964 전체 경계 복원 완료를 주장하지 않는다.
- 현대 원본과 기존 윤곽 사이 접속선 길이를 같은 표시 기준에서 측정했다. MDL 서쪽 12.415px·동쪽 4.455px, 백두산 남서쪽 0.308px·동쪽 0.642px다. 이는 **접속선의 길이**이며 독립 역사 국경에 대한 오차가 아니다. 접속부의 역사적 위치와 해안선 대조는 미완료이며, 이 수치를 0.5px 검사 통과로 해석하지 않는다. [측정값](evidence/korea-boundaries-20261021/connectors.json)

## 데이터 반영과 검증

`work/gis` 원본·카탈로그·현재 세계·역사 타임라인·canonical/preview/shared-boundary·prepared mesh를 재생성했다. 정확한 날짜로 시작한 현재 선택 버전을 스냅샷의 2026-10 한 달로 축소하던 생성기 문제도 수정했다. 현대 자료인 `datePrecision: current`의 월 제한은 유지한다.

검증 증거는 [evidence/korea-boundaries-20261021/](evidence/korea-boundaries-20261021/)에 둔다.

| 검증 | 결과 |
| --- | --- |
| 관련 단위 검사 | 51/51 통과. 정부수립일 전날·당일, 1953/1964 전환, 개성·옹진·속초·철원, 백령도, 천지 귀속, 형상 합집합·중복, 실제 게시용 gzip의 날짜별 가용성 검사 포함 |
| 한계 표시 회귀 검사 | 1/1 통과. canonical provenance의 미복원 안내를 라이브러리 미리보기에 표시 |
| 원본 보존 검사 | 변경 대상 외 255개 현대 국가의 좌표·속성 보존 검사 통과 |
| 독립 Shapely 위상 대조 | 6개 버전 유효. KOR/PRK·PRK/CHN 중복 면적 0. 세 국가 전체 합집합 대칭차 0 |
| 생성물 재현성 | 결정적 역사 타임라인 게시 검사 2/2 통과. 안내문 반영 후 최종 `build-historical-world-timeline.mjs --check`도 통과. 277개 정체성 및 최종 gzip SHA 확인 |
| Web | 최종 안내문 반영 후 편집기·공개 뷰어 2/2 통과. 정보 패널의 두 정부수립일, 라이브러리 6개 날짜와 개성·속초 귀속, 미복원 안내의 실제 표시, 탐색 중 프로젝트 보존 확인. 별도 packet/startup 2/2 통과. 소스/route override 없음 |
| Windows 앱 | full-world stage 1,722개 파일 검사 통과. 최초 빌드 및 최종 안내문 반영 후 증분 빌드 성공. 실제 패키지 WebView 실행은 자동 승인 검토가 실행 명령을 정책상 차단해 미실행 |
| 정적 검사 | 변경 JS와 테스트에 대한 ESLint, `git diff --check` 통과 |
| 시대별 독립 0.5 CSS px 검사 | 미실행 |
| main 통합·push·배포 | 미실행 |

확장 검사에서 기존 `territorial-source-parity`의 독일·아르차흐 역사 형상 고정 해시가 현재 원본과 어긋나는 실패를 발견했다. 독일 예시의 HEAD 원본 해시도 동일한 불일치 값이며, 이 작업에서 해당 원본은 변경하지 않았다. 해당 기존 실패를 통과로 계산하거나 기대 해시를 덮어쓰지 않았다. 이번 변경의 현대 원본 보존 검사는 별도로 통과했다.

기존 라이브러리 controller 검사 3건은 기간 밖 목록 행이 제거될 것으로 기대하지만 현재 서비스는 가용 상태와 함께 행을 유지한다. 동일 3건이 HEAD controller에서도 실패함을 별도 기준선 검사로 확인했다. 해당 기대값을 완화하지 않았으며 위 통과 수에 포함하지 않았다. 전체 테스트 모음은 실행하지 않았다.

최종 빌드 ID는 `0.36.0-build-korea-boundaries-20261021`, 데이터 판본은 `data-7c09e4efc8460540dad6814620d1f2c9`다. 역사 세계 gzip SHA-256은 `0ae448ad648728523fb6ea70ca1d4f076f59e8f72ac200bd4c121bd56359a7b2`다.

Windows 실행 파일은 `C:/Users/taeeu/AppData/Local/PandoLab/build-cache/gis-cargo-gnu/x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe`, 371,743,148바이트, 수정 시각 `2026-10-21T10:33:18.6012610+09:00`, SHA-256 `1c16de154aefdf46433b38decad6b81602d63b5f2365d7f19a393b1a8474341a`다. 빌드에는 Cargo 전역 캐시 마지막 사용 기록의 disk I/O error 1034와 기존 unused_mut 경고가 있었지만 종료 코드는 0이었다. [빌드 증거](evidence/korea-boundaries-20261021/app-build.json)는 실제 실행 증거가 아니다.

앱 실행 거부에는 “blocked by policy” 외 구체적인 사유가 제공되지 않았다. 다른 실행 경로로 우회하지 않았으며 실제 WebView 화면·동작·패키지 내 런타임 자산 일치 검사는 미검증으로 남긴다.

## 판본

최초 반영 기록이다. 북중 확정 전 독립 마스터와 부속도 대조가 확보되면 별도 후속 판본에서 형상을 교체하고 이 문서를 연결한다. 이 보고서의 provisional·미실행 표기를 후속 검사 전까지 유지한다.
