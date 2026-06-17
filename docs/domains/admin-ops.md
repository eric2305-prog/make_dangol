# Admin Ops Domain

## Purpose

관리자 페이지는 단골만들기 운영자가 전체 서비스 상태를 확인하고 문제를 조기에 발견하는 최소 관제 도구다. 1차 MVP에서는 운영 통제와 로그 확인에 집중한다.

## MVP Scope

- 관리자 로그인/권한 확인
- 전체 현황
- 점주/매장 목록
- 구독 상태 확인
- 매장별 고객 현황
- 방문 로그 확인
- 메시지 로그 확인
- 발송 실패 상태 확인

## Out Of Scope

- 매출 리포트
- 발송 비용 상세 분석
- 중복 고객 자동 병합
- AI 품질 평가
- 고급 차트/통계
- 운영자 대량 수정 기능

## Screens

### Overview

표시 지표:

- 총 점주/매장 수
- 총 고객 수
- 오늘 등록 수
- 오늘 방문 수
- 오늘 발송 수
- 오늘 발송 실패 수

### Stores

표시 항목:

- 매장명
- 점주명
- 점주 연락처
- 업종
- 구독 상태
- 생성일
- 고객 수

### Customers

표시 항목:

- 매장명
- 고객명
- 휴대폰 번호 마스킹
- 방문 횟수
- 마지막 방문일
- 상태
- 등록일

### Visit Logs

표시 항목:

- 매장명
- 고객명
- 방문일시
- source
- created_by

### Message Logs

표시 항목:

- 매장명
- 고객명
- message type
- send status
- sent at
- error message

## Admin Authorization

관리자 권한은 일반 점주 권한과 분리한다.

추천 방식:

- `admins` 테이블에 `user_id` 저장
- 서버 컴포넌트 또는 서버 액션에서 `auth.uid()`가 admins에 있는지 확인
- 관리자 전용 데이터 조회는 서버 경계 또는 Edge Function에서 수행

클라이언트에서 `is_admin` 값을 신뢰하지 않는다.

## Data Protection

- 고객 휴대폰 번호는 목록에서 마스킹 표시한다.
- 상세/운영 대응에 필요한 경우에만 원문 접근을 허용한다.
- 관리자 조회도 audit log 대상이 될 수 있도록 이후 확장 여지를 둔다.

## Suggested Routes

```text
/admin
/admin/stores
/admin/customers
/admin/visits
/admin/messages
```

## Verification

- admin이 아닌 사용자는 `/admin`에 접근할 수 없다.
- 관리자 overview가 오늘 등록/방문/발송 수를 표시한다.
- 메시지 실패 로그에서 실패 사유를 확인할 수 있다.
- 점주 데이터와 고객 데이터가 매장 기준으로 연결되어 보인다.
