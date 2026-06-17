# Visit Check-in Domain

## Purpose

방문 체크인 도메인은 기존 고객의 QR 재방문 또는 점주의 누락 방문 보정을 방문 기록으로 남기고, 고객의 방문 횟수와 방문주기 계산값을 갱신한다.

## MVP Scope

- 기존 고객 QR 체크인
- 같은 고객/매장 기준 하루 1회 방문 인정
- 점주 대시보드에서 고객 검색 후 오늘 방문 처리
- `visit_logs` 생성
- `customers.last_visit_at`, `visit_count`, `average_visit_cycle_days`, `next_expected_visit_at`, `status` 갱신

## Out Of Scope

- POS 연동
- 과거 날짜 방문 추가
- 고객 메모
- VIP 태그
- 중복 고객 병합
- 정교한 예측 모델

## QR Check-in Flow

```text
고객이 매장 QR 스캔
→ 휴대폰 번호 입력
→ store_id + phone 조회
→ 고객 있음
→ "오늘 방문 확인" 화면
→ 방문 체크인
→ 오늘 중복 방문 여부 확인
→ visit_logs 생성
→ customers 집계 필드 갱신
→ 체크인 완료 화면
```

## Manual Correction Flow

```text
점주 로그인
→ 고객 검색
→ 고객 상세
→ 오늘 방문 처리
→ 오늘 중복 방문 여부 확인
→ visit_logs 생성(source = manual)
→ customers 집계 필드 갱신
→ 점주 화면에 성공/중복/실패 표시
```

## Visit Cycle Calculation

1차 MVP는 단순 평균만 사용한다.

```text
방문 간격 목록 = 고객의 visit_logs를 visit_at 오름차순으로 정렬한 뒤 인접 방문일 차이 계산
average_visit_cycle_days = 방문 간격 평균
next_expected_visit_at = last_visit_at + average_visit_cycle_days
```

방문 횟수별 처리:

- 1회: `status = 'new'`, 평균 방문주기 없음
- 2회 이상: 평균 방문주기 계산, 기본 `status = 'active'`
- 장기 미방문: 운영 기준일을 초과하면 `status = 'dormant'`

초기 dormant 기준은 `next_expected_visit_at + 14 days` 또는 `last_visit_at + 45 days` 중 더 단순한 기준으로 시작한다.

## Data Model

### visit_logs

필수 필드:

- `id`
- `store_id`
- `customer_id`
- `visit_at`
- `source`
- `created_by`
- `created_at`

제약:

- `source in ('qr_checkin', 'manual')`
- `created_by in ('customer', 'merchant')`
- 같은 `store_id + customer_id + visit_date`는 1회만 허용

### customers

체크인 후 갱신:

- `last_visit_at`
- `visit_count`
- `average_visit_cycle_days`
- `next_expected_visit_at`
- `status`

## Backend Boundary

방문 체크인은 데이터 무결성이 중요하므로 DB 트랜잭션 경계 안에서 처리한다. Edge Function 또는 RPC로 다음 작업을 원자적으로 수행한다.

1. 고객 소유 매장 확인
2. 오늘 중복 방문 여부 확인
3. 방문 로그 생성
4. 방문주기 재계산
5. 고객 집계 필드 갱신

추천 함수:

- `check-in-customer`
- 입력: `store_id`, `customer_id` 또는 `phone`, `source`
- 출력: `checked_in`, `duplicate_today`, `customer_summary`

## UI States

- 기존 고객 확인
- 체크인 확인
- 체크인 처리 중
- 완료
- 오늘 이미 체크인됨
- 실패

## Verification

- 기존 고객이 QR 체크인을 하면 visit count가 1 증가한다.
- 같은 고객이 같은 날짜에 두 번 체크인하면 두 번째는 중복으로 처리된다.
- 점주 수동 방문 처리 시 `source = manual`, `created_by = merchant`로 기록된다.
- 2회 이상 방문부터 평균 방문주기와 다음 예상 방문일이 계산된다.
