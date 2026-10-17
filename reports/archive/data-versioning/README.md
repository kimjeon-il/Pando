# 데이터 버전 관리 — 과거 단계 보고서 통합 요약

> 정리일: 2026-10-17 · 모든 항목은 당시의 **historical-record / 지도 반영 unverified**로 기록됨. 현재 제품을 재검증한 결과가 아니며 오래된 상태를 현재 상태로 해석하지 말 것.

웹·앱 1~11단계의 기준선·번들 전환·구버전 삭제 정책을 합친 이력. 7~10단계의 삭제·배포 미실행 결론을 11단계의 별도 삭제 승인 결과와 구분함.

### ARC-004

**데이터 버전 관리 구조 개선 진행 기록** — 여러 단계의 완료·미완료·CI 결과가 섞여 있는 당시 종합 진행 기록.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/progress.md) · 이전 경로: `reports/archive/data-versioning/progress.md`

### ARC-011

**웹 GIS 자산·참조 기준선** — 당시 웹 세계지도 자산·참조 관계·중복 저장 기준선 조사.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase1-inventory.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase1-inventory.md`

### ARC-012

**Pages 전환·구버전 삭제·선별 병합 준비** — 실행 전 준비와 당시 남은 차단 사유. 완료된 배포라는 뜻이 아님.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase10.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase10.md`

### ARC-013

**구버전 URL 보존 의무 해제 및 지형 삭제** — 정책 변경 후 v0.12.0 구형 자산 삭제·복원·배포 검증 기록.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase11.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase11.md`

### ARC-014

**웹 독립 데이터 번들 생성** — 앱 버전과 독립적인 GIS 번들 매니페스트와 내용 해시 검사 경로 구현.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase2.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase2.md`

### ARC-015

**웹 런타임·캐시·검증기 전환** — 당시 Worker·캐시·공유 국경 참조 변경과 검증 범위.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase3.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase3.md`

### ARC-016

**구버전 GIS 자산 참조 감사** — 삭제 가능 여부와 보존 대상 참조를 판정한 6단계 조사.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase6.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase6.md`

### ARC-017

**공개 URL·앱 릴리스 보존 안전성** — 당시 브랜치·릴리스·URL 감사. 이 단계의 삭제 승인 파일은 0개.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase7.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase7.md`

### ARC-018

**URL 보존형 배포 사전검증** — 배포·구버전 자산 정리의 사전검증과 제약·차단 사유.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase8.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase8.md`

### ARC-019

**Pages 1GB 용량 타당성 검사** — 기존 URL을 모두 보존하는 게시 범위가 당시 Pages 제한을 초과한다는 실측.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/web-data-versioning-phase9.md) · 이전 경로: `reports/archive/data-versioning/web-data-versioning-phase9.md`

### ARC-024

**앱 GIS 고정 자산·출처 기준선** — 당시 앱 내장 GIS 자산·원본 출처·오프라인 참조 조사.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/app-data-versioning-phase1-inventory.md) · 이전 경로: `reports/archive/data-versioning/app-data-versioning-phase1-inventory.md`

### ARC-025

**앱 데이터 출처·동기화 계약** — 해시 검증과 승인형 데이터 동기화 경로를 다룬 당시 계약 개편.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/app-data-versioning-phase4.md) · 이전 경로: `reports/archive/data-versioning/app-data-versioning-phase4.md`

### ARC-026

**웹·앱 역사 라이브러리 출처 검증** — 당시 웹·앱 국가 라이브러리 정적 비교 및 별도 실검증의 경계.

[정리 전 전체 원문·실측·출처 링크](https://github.com/kimjeon-il/Pando/blob/9e301d4adc36a3f28e825be5bf113efc77b476c4/reports/archive/data-versioning/app-data-versioning-phase5.md) · 이전 경로: `reports/archive/data-versioning/app-data-versioning-phase5.md`

## 보존·복원 원칙

원문은 위 고정 Git 커밋에 그대로 남아 있으며 필요한 경우 재열람·복원할 수 있음. 원본 GIS 자료, 현재 생성기 입력, 현행 기술 계약 및 테스트 증거는 이 정리 대상에 포함되지 않음.
