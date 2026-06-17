# Customer Registration Domain

## Purpose

고객 등록 도메인은 매장 QR을 통해 유입된 고객을 `store_id + phone` 기준으로 식별하고, 신규 고객이면 개인정보/마케팅 동의와 함께 고객 레코드와 첫 방문 기록을 생성한다.

## MVP Scope

- 매장 QR URL: `/s/{store_id}`
- 휴대폰 번호 입력
- `store_id + phone` 기준 고객 조회
- 신규 고객 등록 화면 분기
- 고객 이름, 휴대폰 번호, 개인정보 수집 동의, 마케팅 수신 동의 저장
- 신규 고객 등록 직후 첫 방문 로그 생성
- 신규 고객 welcome 카카오 메시지 발송 요청 생성

## Out Of Scope

- 카카오 인증 기반 고객 식별
- 생일, 성별, 관심사 등 추가 프로필
- 쿠폰
- VIP 태그
- 고객 메모
- 중복 고객 병합

## Primary Flow

```text
고객이 매장 QR 스캔
→ /s/{store_id} 접속
→ 매장 존재 여부 확인
→ 휴대폰 번호 입력
→ phone 정규화
→ store_id + phone 조회
→ 고객 없음
→ 이름/동의 입력
→ customers 생성
→ visit_logs 첫 방문 생성
→ message_logs welcome pending 생성
→ 카카오 발송 함수 호출
→ 등록 완료 화면
```

## Existing Customer Branch

휴대폰 번호 조회 결과 기존 고객이 있으면 신규 등록을 만들지 않고 방문 체크인 도메인으로 넘긴다.

```text
store_id + phone 조회
→ 고객 있음
→ "오늘 방문 확인" 화면
→ visit-checkin flow로 이동
```

## Data Model

### customers

필수 필드:

- `id`
- `store_id`
- `name`
- `phone`
- `privacy_agreed`
- `marketing_agreed`
- `created_at`
- `last_visit_at`
- `visit_count`
- `average_visit_cycle_days`
- `next_expected_visit_at`
- `status`

제약:

- `unique(store_id, phone)`
- `privacy_agreed = true`인 경우에만 신규 등록 허용
- `status in ('new', 'active', 'dormant')`

### visit_logs

신규 등록 시 첫 방문 기록을 함께 남긴다.

- `source = 'qr_checkin'`
- `created_by = 'customer'`

### message_logs

신규 등록 완료 후 welcome 메시지 로그를 만든다.

- `message_type = 'welcome'`
- `send_channel = 'kakao'`
- `send_status = 'pending'`

## Backend Boundary

고객 등록 mutation은 클라이언트에서 직접 `customers`를 쓰지 않고 Supabase Edge Function 또는 서버 액션을 통해 처리한다. 카카오 발송까지 이어지는 흐름은 외부 API secret이 필요하므로 Edge Function을 우선 경계로 둔다.

추천 함수:

- `register-or-checkin-customer`
- 입력: `store_id`, `phone`, optional `name`, `privacy_agreed`, `marketing_agreed`
- 출력: `mode: "new_registration" | "existing_customer" | "registered" | "checked_in"`

## Validation

- `store_id`는 UUID 또는 프로젝트에서 정한 공개 ID 형식 검증
- `phone`은 숫자만 남기고 국내 휴대폰 번호 형식으로 정규화
- `name`은 신규 등록 시 필수
- `privacy_agreed`는 신규 등록 시 반드시 true
- `marketing_agreed`가 false이면 자동 마케팅성 발송 대상에서 제외할지 정책을 명시해야 한다

## UI States

- QR 매장 로딩
- 매장 없음
- 휴대폰 번호 입력
- 기존 고객 확인
- 신규 고객 추가 정보 입력
- 등록 중
- 등록 완료
- 등록 실패

## Verification

- 같은 매장에서 같은 휴대폰 번호로 두 번 등록해도 고객이 중복 생성되지 않는다.
- 신규 등록 시 `customers`, `visit_logs`, `message_logs`가 함께 생성된다.
- 개인정보 동의가 false면 등록이 거부된다.
- 다른 `store_id`에서는 같은 휴대폰 번호도 별도 고객으로 등록된다.
