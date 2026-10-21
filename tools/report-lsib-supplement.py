"""Write the retained-interval inventory and its human-readable GIS report."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/geography/country-files-lsib-2026-10-21.md'
DIAGNOSTICS = REPORT.parent / 'diagnostics'
REASONS = {
    'existing-disputed-territory-or-protected-country-pair': '분쟁선 인접 또는 명시적 보호 쌍',
    'no-matching-LSIB-country-pair': '기존 국가 코드 쌍과 LSIB 불일치',
    'all-segments-withheld': '안전한 접합·위상 조건 미충족',
    'river-island-sovereignty-needs-independent-review': '하중도 귀속 별도 검토 필요',
    'special-or-separation-line': '특수 경계·분리선',
    'existing-dated-historical-geometry-protected': '기존 날짜별 역사 형상 보호',
    'no-existing-shared-country-chain': '기존 공유 경계와 대응하지 않음',
    'uncertain-or-joint-sovereignty': '불확실한 귀속·공동 주권',
}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidates', default='build-native/lsib-supplement/candidates.json')
    args = parser.parse_args()
    candidate = read(ROOT / args.candidates)
    source_index = read(ROOT / 'tools/historical-library/sources/lsib-11.4/line-index.json')
    names = {}
    for path in (ROOT / 'assets/data/territorial-entities/source/countries').glob('*.json'):
        entity = read(path)
        code = entity.get('sourceInfo', {}).get('featureId')
        if code:
            names[code] = entity['names'].get('ko', code)
    records = []
    for raw in candidate['boundaries']:
        row = dict(raw)
        matched = [r for r in source_index if sorted((r['properties']['CC1_GENC3'], r['properties']['CC2_GENC3'])) == row['countries']]
        row.setdefault('sourceLineIds', [r['properties']['ID'] for r in matched])
        row['sourceExtents'] = [r['bbox'] for r in matched]
        row['countryNames'] = [names.get(code, code) for code in row['countries']]
        row['reasonKo'] = REASONS.get(row.get('reason'), '')
        records.append(row)
    withheld = [r for r in records if r['status'] == 'withheld']
    partial = [r for r in records if r['status'] != 'withheld']
    sections = sum(sum(s['status'] != 'withheld' for s in r['segments']) for r in partial)
    inventory = {'schemaVersion': 1, 'sourceRevision': candidate['sourceRevision'],
                 'sourceId': candidate['sourceId'], 'sourcePublished': candidate['sourcePublished'],
                 'changes': [{'entityId': r['entityId'], 'geometryVersionId': r['geometryVersionId'],
                              'outputFileSha256': hashlib.sha256((ROOT / 'assets/data/territorial-entities/source/countries' /
                                  (r['entityId'].replace(':', '-') + '.json')).read_bytes()).hexdigest()}
                             for r in candidate['changes']],
                 'counts': {'changedCountries': len(candidate['changes']), 'partiallySupplementedPairs': len(partial),
                            'supplementedSections': sections, 'whollyWithheldEntries': len(withheld)},
                 'lengthUnits': 'unprojected angular degrees, not kilometres or area',
                 'sourceExtentsScope': 'full LSIB country-pair extents; retained segments use anchors and reasons',
                 'boundaries': records}
    DIAGNOSTICS.mkdir(parents=True, exist_ok=True)
    (DIAGNOSTICS / 'country-files-lsib-inventory-2026-10-21.json').write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = ['# 국가별 원본 분리와 LSIB 11.4 육상 국경 보충', '',
        '> 보고서 ID: `GEO-WORLD-20261021` · 상태: `implemented-partially / provisional` · 지도 반영: `work-gis-only` · 색인일: 2026-10-21  ',
        '> 조사·수정 기준: `work/gis`, 원본 커밋 `4c7f30453fc5de61efd1ab0fb03d7fdaa92fe3a7`  ',
        '> Web/App 공통 라이브러리 자료 수정. main 병합·push·배포 및 앱 실행파일 빌드 없음.', '',
        '## 대상과 기준일', '',
        '국가·지역 객체 281개를 각각 `source/countries/state-*.json`으로 분리했다. 이름·존속기간·날짜별 형상은 해당 객체가 소유한다. ',
        '계보 262개는 `source/lineages/`의 참조 전용 schema 2 파일이다. `source/views/world.json`은 258개 객체/버전의 표시 선택 목록이며 공통 기준일이 없다. ',
        '날짜 없는 가져오기는 객체에 명시한 대표 버전을 사용하고 `sourceReferenceDate: null`을 기록한다. 날짜를 지정하면 해당 객체의 기간으로만 조회한다. ',
        '역사 뷰어의 날짜 있는 출력 쿼리는 별도 `historical-publication.recipe.json`에 둔다. 출력 날짜를 전 세계 관측일이나 국가 수립일로 사용하지 않는다.', '',
        'LSIB 11.4 발행일은 2025-02-24이다. 이 날짜는 각 경계의 법적 효력일이나 현지 관측일로 확정되지 않았다. 날짜가 있는 역사 형상을 현대 LSIB로 교체하지 않았다.', '',
        '## 근거와 방법', '',
        '- 원본: [미 국무부 LSIB 공식 목록](https://geodata.state.gov/geonetwork/srv/api/records/3bdb81a0-c1b9-439a-a0b1-85dac30c59b2), [공식 배포 ZIP](https://data.geodata.state.gov/LSIB.zip). 미국 정부 관점의 자료이며 법적·역사적 정답을 보증하지 않는다.',
        '- 원본 395개 벡터와 전체 속성은 `tools/historical-library/sources/lsib-11.4/boundaries.geojson.gz`에 별도 보존했다. 43,179,013 bytes. 원본 ZIP/SHP/DBF/master 해시와 권리·판본은 같은 폴더의 `provenance.json`, upstream README/XML에 기록했다.',
        '- 분쟁 보호 근거: [Natural Earth v5.1.1](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.1/10m_cultural)의 분쟁선과 0.15도 주변 구간, 별도로 지정한 보호 국가 쌍. 이 완충은 보수적인 제외 규칙이며 분쟁의 정확한 범위 판정이 아니다.',
        '- 기존 공유 경계와 LSIB가 실제 교차하는 지점 사이만 양쪽 국가에 동일하게 적용했다. 해안 접점이나 삼합점을 임의의 직선으로 연결하지 않았다. 교차점 밖의 옛 끝부분은 유지했다.',
        '- 후보 위상 검토는 Shapely, 최종 제품 형상 정규화는 기존 C++ 계산 코어를 사용했다. 별도의 런타임 형상 소유자는 추가하지 않았다.',
        '- 원본 좌표는 보존하고 표시 파생본만 0.0004도 허용치로 단순화했다. 고배율 기준은 2560 CSS px, flatZoom=64이다.', '',
        '## 확인 결과와 한계', '',
        f'- 현대 객체 **{len(candidate["changes"])}개**, 국가 쌍 **{len(partial)}개**, 구간 **{sections}개**를 부분 보충했다. 완전 교체로 표시하지 않는다. 전부 보류한 목록은 **{len(withheld)}항목**이다. 같은 국가 쌍에 여러 LSIB 선이 있어 항목 수와 고유 국가 쌍 수는 다를 수 있다.',
        '- 원본 대비 281개 객체의 ID·존속기간·버전 ID 유지, 역사 버전 41개 형상 동일, 그 외 144개 객체 형상 동일을 확인했다. 현대 변경 폴리곤 유효성과 전역 미공유 변 집합 동일을 확인해 해안선 변경·공유선 단절을 검사했다.',
        '- 실제 보충한 243개 구간을 상세 LSIB 원본과 양방향 비교했다. 표본 5,893,626개, 표본 최대 0.182045 CSS px, 연속 선분의 편차 상한 **0.409600 CSS px**이다. 0.001도 이하 표본 간격의 절반을 오차 상한에 더했다.',
        '- 이 수치는 **교차점 사이에 보충한 구간의 원본 대비 단순화 편차**이다. 남긴 옛 끝부분, 교체하지 않은 경계, 실제 지상 국경의 정확도, 독립적인 역사 경계의 0.5px 충족을 검증한 수치가 아니다.',
        '- 모든 해안선·섬 외곽과 기존 영유권 배정은 유지했다. 쿠릴·독도·센카쿠·대만·포클랜드 등 해상/도서 영유권은 이번 육상선 보충으로 변경되지 않는다. 하중도·공동 주권·분리선은 별도 검토가 필요하다.',
        '- 새 자료 위치 수는 1,100,074개다. canonical packet 생성 예산은 기존 decoded 10/compressed 5.5 MiB에서 24/13 MiB로 조정했다. 실제 gzip packet은 12,612,625 bytes다. 전송 형식은 같지만 자료량·메모리 부담이 증가했다. 기기 성능 측정은 하지 않았다.', '',
        '## 데이터 반영과 검증', '',
        '국가 원본·참조 계보·명시적 표시 목록, 재생성 도구, 편집·독립 게시 경로와 관련 테스트를 함께 변경했다. 원본 Natural Earth 파일은 유지했다. 자세한 검증 상태는 아래 최종 실행 기록을 참고한다.', '',
        '- [보류 및 부분 보충 전체 목록 JSON](diagnostics/country-files-lsib-inventory-2026-10-21.json)',
        '- [원본·역사·해안·공유선 무결성 검사](diagnostics/country-files-lsib-integrity-2026-10-21.json)',
        '- [보충 구간 고배율 편차 검사](diagnostics/country-files-lsib-screen-2026-10-21.json)', '',
        '## 최종 실행 기록', '',
        '| 범위 | 결과와 한계 |', '| --- | --- |',
        '| 객체 분리·참조·대표 가져오기·편집 저장·private source materialization·native JS transport | 관련 unit 49개. 첫 실행의 3건 실패를 수정하고 해당 15개만 재실행해 통과. 실제 Rust/WebView 실행은 하지 않음 |',
        '| 직접 source 소비자와 해안·폴리곤 회귀 | 관련 unit 34개 통과 |',
        '| 파생 packet·전국 chunk·공유선 일치 | 관련 unit 10개. 자료 개수·snapshot 계약 변경 2건 수정 후 해당 2개만 재실행해 통과. 원본/source packet Float64 동일, 공유선 전 구간 동일 |',
        '| inspection / source 이름·국기 독립 게시 반영 | inspection unit 10개 통과, 실제 historical compiler를 사용한 publication metadata unit 1개 통과 |',
        '| Python source 소비자 | 15개 중 기존 Web/editor 구분 기대 1건 수정 후 해당 1개 재실행 통과 |',
        '| LSIB 접합·쌍방 경계·분쟁 제외 | Python unit 5개 통과. 미세한 부동소수점 접합점 중복을 수정하고 재검증함 |',
        '| 브라우저 편집 흐름 | 실제 Chromium에서 대표 선택·저장·재로드·날짜 없는 가져오기 및 기존 이름·날짜 undo/redo·재로드 2개 통과. mock native 저장소이며 실제 OS 연결 검증과 다름 |',
        '| 공개 Web 뷰어 | 재생성한 역사 프로젝트 준비 완료와 남북한 존속기간 확인 1개 통과, pageerror 없음 |',
        '| 정적 검사·데이터 산출물 | 변경 JS ESLint 통과, chunk freshness / world bundle digest·size / version metadata 검사 통과, 한국 재생성 도구 --check 통과 |',
        '| 재생성 | source chunks, current world, historical project, world mesh/preview/bundle/shared lines 및 prepared meshes 생성. prepared 337개 중 176개 재사용. 앱 실행파일은 빌드하지 않음 |',
        '| 검토 | 독립 read-only reviewer 1회. 과거 embedded lineage recipe와 workflow 소비자 및 lineage schema 생성 문제 수정. 별도 에이전트 검사·전체 suite 없음 |', '',
        '원시 실행 로그는 로컬 `build-native/lsib-supplement/`에 보존했다. 초기 실패를 통과로 집계하지 않으며 위 표는 수정 후 해당 범위의 결과다. pnpm 실행이 의존성 재설치를 시도하다 TTY 조건에서 중단되어, 설치 없이 기존 Node CLI로 브라우저 검사를 실행했다.', '',
        '기하 검사를 재현할 때 보존한 inventory JSON을 `--candidate`에 전달할 수 있다. 무결성 도구는 `--base 4c7f30453fc5de61efd1ab0fb03d7fdaa92fe3a7`, 화면 편차 도구는 `--archive <보존 ZIP>`과 `--output <진단 경로>`를 요구한다. ZIP 해시는 provenance에 고정했다. 부분 진단은 `--pair AFG/CHN`처럼 지정한다.', '',
        '## 전부 보류한 경계', '',
        '아래 목록의 분쟁·보호는 기하 자동 교체를 하지 않았다는 뜻이다. 각 국가 쌍의 법적 지위를 새로 확정하지 않는다. 코드가 다른 팔레스타인/남수단/서사하라 등의 항목도 원본 코드를 유지했다.', '',
        '| 국가·지역 쌍 | 보류 사유 | 구간별 세부 사유 |', '| --- | --- | --- |']
    def label(row):
        return ' / '.join(f'{name} ({code})' for name, code in zip(row['countryNames'], row['countries']))
    for row in withheld:
        details = sorted(set(s.get('reason', '') for s in row.get('segments', []) if s.get('reason')))
        lines.append(f'| {label(row)} | {row["reasonKo"]} | {"; ".join(details) or row.get("label", "") or "—"} |')
    lines += ['', '## 부분 보충 후 남은 옛 구간', '',
              '모든 아래 국가 쌍은 실제 교차점 밖의 옛 끝부분을 남겼다. 길이는 지도 좌표의 각도 길이이며 km·면적·국경 정확도 비율이 아니다. 정확한 접합 좌표·원본 선 ID는 JSON 목록에 있다.', '',
              '| 국가 쌍 | 보충 구간 수 | 남긴 옛 끝부분 길이(도) | 전체 보류된 추가 구간 수 |', '| --- | ---: | ---: | ---: |']
    for row in partial:
        good = [s for s in row['segments'] if s['status'] != 'withheld']
        lines.append(f'| {label(row)} | {len(good)} | {sum(s["retained_length_degrees"] for s in good):.6f} | {len(row["segments"])-len(good)} |')
    lines += ['', '## 판본', '',
              '초판: 2026-10-21, GEO-WORLD-20261021. 원본 자료 발행일·역사 효력일·이번 로컬 반영일은 서로 구분한다.', '']
    REPORT.write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'report': str(REPORT), 'counts': inventory['counts'],
                      'withheldReasons': dict(Counter(r['reason'] for r in withheld))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
