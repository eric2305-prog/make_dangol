# Dangol MVP Implementation Plan

## Objective

단골만들기 1차 MVP는 아래 자동화 루프가 실제 서비스로 작동하는지 검증한다.

```text
QR로 고객을 모은다
→ 방문 데이터를 쌓는다
→ 고객 상태에 맞는 메시지를 만든다
→ 카카오톡으로 자동 발송한다
→ 재방문을 유도한다
```

## Source Instructions

이 계획은 다음 기준 문서를 바탕으로 작성한다.

- `dangol_codex_mvp_kit/dangol_codex_mvp_kit/CODEX.md`
- `dangol_codex_mvp_kit/dangol_codex_mvp_kit/docs/brief.md`
- `dangol_codex_mvp_kit/dangol_codex_mvp_kit/.codex/rules/architecture.md`
- `dangol_codex_mvp_kit/dangol_codex_mvp_kit/.codex/rules/nextjs.md`
- `dangol_codex_mvp_kit/dangol_codex_mvp_kit/.codex/rules/supabase.md`

보안/RLS와 카카오 연동 위험은 아래 전용 문서에도 분리해 둔다.

- `docs/plans/supabase-rls-notes.md`
- `docs/plans/kakao-integration-risks.md`

## Proposed Project Structure

```text
app/
  layout.tsx
  page.tsx
  s/[storeId]/page.tsx
  dashboard/
    page.tsx
    store/page.tsx
    qr/page.tsx
    customers/page.tsx
    customers/[customerId]/page.tsx
    messages/page.tsx
  admin/
    page.tsx
    stores/page.tsx
    customers/page.tsx
    visits/page.tsx
    messages/page.tsx
  auth/
    sign-in/page.tsx
components/
  dashboard/
  public-registration/
  admin/
lib/
  supabase/
    client.ts
    server.ts
  validation/
  domain/
    visits.ts
    messages.ts
supabase/
  migrations/
  functions/
    register-or-checkin-customer/
    check-in-customer/
    send-kakao-message/
    run-message-dispatch/
docs/
  domains/
  plans/
```

## Core Data Model

### stores

- `id`
- `owner_user_id`
- `owner_name`
- `store_name`
- `phone`
- `business_type`
- `subscription_status`
- `created_at`
- `updated_at`

### customers

- `id`
- `store_id`
- `name`
- `phone`
- `privacy_agreed`
- `marketing_agreed`
- `created_at`
- `updated_at`
- `last_visit_at`
- `visit_count`
- `average_visit_cycle_days`
- `next_expected_visit_at`
- `status`

Constraints:

- `unique(store_id, phone)`
- `status in ('new', 'active', 'dormant')`

### visit_logs

- `id`
- `store_id`
- `customer_id`
- `visit_at`
- `source`
- `created_by`
- `created_at`

Constraints:

- `source in ('qr_checkin', 'manual')`
- `created_by in ('customer', 'merchant')`
- 하루 중복 체크인 방지용 unique index

### message_logs

- `id`
- `store_id`
- `customer_id`
- `message_type`
- `message_body`
- `send_channel`
- `send_status`
- `sent_at`
- `error_message`
- `created_at`

Constraints:

- `message_type in ('welcome', 'revisit', 'dormant')`
- `send_channel = 'kakao'`
- `send_status in ('pending', 'success', 'failed')`

### admins

- `id`
- `user_id`
- `created_at`

## Vertical Slices

각 항목은 독립적으로 구현하고 검증할 수 있어야 한다.

### 1. Merchant Store Foundation And QR Route

Goal:

- 점주가 로그인 후 매장을 만들고, 고객 등록용 QR URL을 확인할 수 있다.

Includes:

- Next.js App Router 초기 구조
- Supabase Auth 연결
- `stores` migration
- `stores` RLS
- `/dashboard/store`
- `/dashboard/qr`
- `/s/[storeId]` 공개 라우트에서 매장 존재 확인

Verification:

- 로그인 사용자는 본인 매장만 생성/조회할 수 있다.
- 매장 생성 후 `/s/{store_id}` URL이 생성된다.
- 존재하지 않는 store ID는 오류 상태를 보여준다.
- service role key가 클라이언트에 노출되지 않는다.

### 2. Customer Phone Lookup And New Registration

Goal:

- QR로 들어온 고객이 휴대폰 번호를 입력하고, 신규 고객이면 등록과 첫 방문 기록이 생성된다.

Includes:

- `customers` migration
- `visit_logs` migration
- `register-or-checkin-customer` Edge Function 초안
- 휴대폰 번호 정규화와 Zod validation
- `/s/[storeId]` 신규 등록 UI
- 개인정보/마케팅 동의 체크
- 신규 등록 시 첫 `visit_logs` 생성

Verification:

- 신규 고객 등록 시 customer 1개와 visit log 1개가 생성된다.
- `store_id + phone` unique 제약으로 중복 등록이 막힌다.
- 개인정보 동의가 없으면 등록되지 않는다.
- 같은 전화번호라도 다른 매장에서는 별도 고객으로 등록된다.

### 3. Existing Customer QR Check-in

Goal:

- 기존 고객이 같은 QR에서 휴대폰 번호를 입력하면 신규 등록 대신 오늘 방문 체크인이 된다.

Includes:

- 기존 고객 분기 UI
- `check-in-customer` 처리
- 하루 1회 중복 체크인 방지
- `customers.last_visit_at`, `visit_count` 갱신
- 2회 이상 방문 시 평균 방문주기 계산

Verification:

- 기존 고객은 새 customer를 만들지 않는다.
- 체크인 후 visit count가 증가한다.
- 같은 날짜의 두 번째 체크인은 중복으로 응답한다.
- 2회 이상 방문부터 `average_visit_cycle_days`와 `next_expected_visit_at`이 계산된다.

### 4. Welcome Kakao Auto-send With Logs

Goal:

- 신규 등록 직후 welcome 메시지가 자동으로 생성되고 카카오 발송 성공/실패가 기록된다.

Includes:

- `message_logs` migration
- welcome 메시지 템플릿
- `send-kakao-message` Edge Function
- 카카오 API 환경변수
- pending → success/failed 상태 갱신
- 실패 사유 저장

Verification:

- 신규 등록 후 welcome message log가 생성된다.
- 카카오 성공 응답이면 success와 sent_at이 저장된다.
- 카카오 실패 응답이면 failed와 error_message가 저장된다.
- 클라이언트 코드에 카카오 secret이 없다.

### 5. Revisit And Dormant Message Dispatch

Goal:

- 방문주기와 장기 미방문 기준으로 revisit/dormant 메시지를 자동 발송한다.

Includes:

- `run-message-dispatch` Edge Function
- 대상 고객 조회
- marketing consent 필터
- revisit/dormant 템플릿
- Scheduled Function 또는 Vercel Cron 연결
- 발송 중복 방지 기준

Verification:

- `next_expected_visit_at` 기준 대상 고객에게 revisit 로그가 생성된다.
- dormant 기준에 도달한 고객에게 dormant 로그가 생성된다.
- 마케팅 미동의 고객은 제외된다.
- 같은 고객에게 같은 유형 메시지가 과도하게 중복 발송되지 않는다.

### 6. Merchant Customer Dashboard And Manual Visit Correction

Goal:

- 점주가 고객 목록과 상세를 보고, QR 누락 방문을 오늘 방문 처리로 보정할 수 있다.

Includes:

- `/dashboard/customers`
- `/dashboard/customers/[customerId]`
- 고객 검색
- 고객 상세
- 오늘 방문 처리
- 고객 이름/휴대폰 번호 수정
- 고객별 메시지 이력

Verification:

- 점주는 본인 매장의 고객만 볼 수 있다.
- 검색은 이름 또는 휴대폰 번호로 동작한다.
- 오늘 방문 처리 후 visit log와 customer 집계가 갱신된다.
- 중복 방문 처리 시 경고 상태가 표시된다.

### 7. Admin Ops Console

Goal:

- 운영자가 전체 매장, 고객, 방문, 메시지 상태를 최소 수준으로 관제한다.

Includes:

- `admins` migration
- admin authorization
- `/admin`
- `/admin/stores`
- `/admin/customers`
- `/admin/visits`
- `/admin/messages`
- 휴대폰 번호 마스킹 표시

Verification:

- admin이 아닌 사용자는 관리자 페이지에 접근할 수 없다.
- 전체 현황에 총 매장 수, 총 고객 수, 오늘 등록/방문/발송 수가 표시된다.
- 메시지 실패 로그와 error message를 확인할 수 있다.

### 8. Release Hardening

Goal:

- MVP 배포 전에 보안, 입력 검증, 모바일 UI, 운영 환경변수를 점검한다.

Includes:

- lint/typecheck/build
- Supabase RLS review
- Edge Function secret review
- desktop/mobile browser verification
- Vercel 환경변수 정리
- QA checklist 문서화

Verification:

- build가 성공한다.
- public table RLS가 모두 켜져 있다.
- broad policy가 의도 없이 남아 있지 않다.
- 주요 화면이 모바일/데스크톱에서 깨지지 않는다.

## Implementation Order

1. Merchant Store Foundation And QR Route
2. Customer Phone Lookup And New Registration
3. Existing Customer QR Check-in
4. Welcome Kakao Auto-send With Logs
5. Revisit And Dormant Message Dispatch
6. Merchant Customer Dashboard And Manual Visit Correction
7. Admin Ops Console
8. Release Hardening

## First Slice To Implement

가장 먼저 구현할 항목은 `1. Merchant Store Foundation And QR Route`다.

이유:

- 모든 고객 등록/방문/메시지 데이터가 store를 기준으로 연결된다.
- QR URL이 있어야 고객 등록 vertical slice를 독립적으로 검증할 수 있다.
- RLS의 기본 소유권 모델을 먼저 확정해야 이후 고객/방문/메시지 정책이 흔들리지 않는다.

## Supabase Security And RLS Notes

- 모든 public domain table은 RLS를 켠다.
- `stores.owner_user_id = auth.uid()`를 점주 소유권의 기준으로 삼는다.
- 점주는 본인 store에 연결된 customers, visit_logs, message_logs만 조회할 수 있다.
- QR 고객 등록/체크인은 public 입력이 필요하지만 DB 직접 쓰기는 허용하지 않는다. Edge Function에서 입력 검증 후 service role로 제한된 mutation을 수행한다.
- service role key, 카카오 secret, 외부 API key는 클라이언트에 노출하지 않는다.
- 관리자 권한은 `admins` 테이블 또는 custom claim으로 서버 경계에서 확인한다.
- 휴대폰 번호는 unique 제약에 필요하지만 개인정보이므로 목록 UI에서는 마스킹한다.
- `using (true)` 정책은 공개 매장 조회처럼 목적이 명확한 경우에만 제한된 컬럼/뷰로 허용한다.

## Kakao Integration Risks

- 알림톡/친구톡/비즈메시지 대행사 중 어떤 방식인지에 따라 승인, 템플릿, 발신 프로필 요건이 달라진다.
- 템플릿 심사 지연으로 welcome/revisit/dormant 문구가 즉시 발송되지 못할 수 있다.
- 마케팅 수신 동의와 야간 발송 제한 등 법적/정책적 제약을 확인해야 한다.
- 카카오 API 장애 또는 대행사 장애 시 실패 로그와 재시도 정책이 필요하다.
- 발송 비용이 누적될 수 있으므로 MVP에서도 발송량 제한과 관리자 관제가 필요하다.
- 외부 API secret이 Edge Function 환경변수에만 존재하는지 반드시 확인해야 한다.

## Excluded Features

- POS 연동
- 카카오 인증 기반 고객 식별
- 쿠폰
- 링크 클릭 추적
- VIP 태그
- 고객 메모
- 고급 통계
- 복잡한 캠페인 빌더
- 점주 메시지 승인 기능
