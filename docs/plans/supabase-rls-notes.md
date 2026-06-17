# Supabase And RLS Notes

## Purpose

단골만들기 1차 MVP의 데이터는 매장, 고객 휴대폰 번호, 방문 기록, 카카오 발송 로그를 포함한다. 따라서 Supabase Auth, Postgres RLS, Edge Function 경계를 먼저 정하고 이후 vertical slice를 구현한다.

## Security Boundary

- Supabase Auth는 점주와 관리자의 사용자 식별에 사용한다.
- 점주 소유권 기준은 `stores.owner_user_id = auth.uid()`로 둔다.
- 고객 QR 등록/체크인은 공개 진입점이지만, public client가 직접 `customers`, `visit_logs`, `message_logs`를 쓰지 않는다.
- 공개 mutation은 Supabase Edge Function에서 입력 검증 후 제한된 service role 작업으로 처리한다.
- 카카오 secret, service role key, 외부 API key는 브라우저 코드에 노출하지 않는다.

## Tables Requiring RLS

- `stores`
- `customers`
- `visit_logs`
- `message_logs`
- `admins`

모든 public domain table은 RLS를 켠다.

## Store Policies

점주:

- 본인 `owner_user_id`의 store만 조회한다.
- 본인 `owner_user_id`의 store만 생성/수정한다.

관리자:

- `admins.user_id = auth.uid()`인 경우에만 전체 store 조회를 허용한다.

공개 QR:

- `/s/{store_id}`에서 필요한 최소 매장 정보만 노출한다.
- 공개 조회가 필요하면 전체 `stores` table에 `using (true)`를 걸지 말고 public-safe view 또는 제한된 RPC를 우선 사용한다.

## Customer Policies

점주:

- 본인 store에 속한 customer만 조회/수정한다.
- 휴대폰 번호는 목록 화면에서 마스킹 표시한다.

공개 QR:

- 고객 등록과 기존 고객 조회는 Edge Function으로만 처리한다.
- `store_id + phone` 조회 결과가 다른 고객의 개인정보를 노출하지 않도록 응답 필드를 제한한다.

관리자:

- 운영 확인에 필요한 범위에서만 조회한다.

## Visit Log Policies

점주:

- 본인 store의 visit log만 조회한다.
- 수동 방문 처리는 서버 액션 또는 Edge Function으로 처리한다.

공개 QR:

- QR 체크인은 Edge Function이 중복 체크인 방지와 집계 갱신까지 원자적으로 처리한다.

## Message Log Policies

점주:

- 본인 store의 message log만 조회한다.

공개 QR:

- message log 직접 조회/생성은 허용하지 않는다.

Edge Function:

- pending 생성, 카카오 발송, success/failed 갱신을 담당한다.

## Admin Policies

- 관리자 여부는 클라이언트 상태가 아니라 서버 경계에서 확인한다.
- `admins` table 또는 custom claim으로 판별한다.
- admin이 아닌 사용자는 `/admin` route와 admin data access 모두 차단한다.

## RLS Review Checklist

- 모든 public domain table에 RLS가 켜져 있는가?
- RLS는 켜졌지만 policy가 없어 기능이 막히는 테이블이 없는가?
- 의도 없는 `using (true)` policy가 없는가?
- 점주가 다른 store의 customers, visit_logs, message_logs를 볼 수 없는가?
- 공개 QR route가 개인정보를 반환하지 않는가?
- service role key가 Edge Function 환경변수에만 있는가?
- 입력 검증이 Edge Function 또는 서버 action에서 수행되는가?
- 휴대폰 번호 unique 제약과 중복 체크인 제약이 DB 레벨에 있는가?

## First Implementation Guardrails

첫 vertical slice에서 `stores`와 RLS 모델을 먼저 확정한다. 이후 customers, visit_logs, message_logs는 모두 store 소유권을 상속하는 방식으로 정책을 작성한다.
