# DB_SCHEMA.md

## Purpose

Supabase database 기준 문서입니다.
MVP는 `store_id + phone`으로 고객 중복 생성을 막고, 고객 정보와 방문 기록을 분리합니다.

## Tables

### owners

점주 계정 정보입니다.

- `id`: 내부 owner ID
- `user_id`: Supabase Auth 사용자 ID
- `name`: 점주 이름
- `email`: 점주 이메일
- `created_at`, `updated_at`: 생성/수정 시각

### stores

매장 정보입니다.

- `id`: 매장 ID
- `owner_id`: 점주 ID
- `name`: 매장명
- `phone`: 매장 전화번호
- `address`: 매장 주소
- `is_active`: 사용 여부
- `created_at`, `updated_at`: 생성/수정 시각

### customers

고객 기본 정보입니다.

- `id`: 고객 ID
- `store_id`: 매장 ID
- `name`: 고객 이름
- `phone`: 고객 휴대폰 번호
- `privacy_agreed`: 개인정보 수집 동의
- `marketing_agreed`: 마케팅 수신 동의
- `visit_count`: 방문 횟수
- `last_visit_at`: 마지막 방문 시각
- `status`: `new`, `active`, `dormant`
- `created_at`, `updated_at`: 생성/수정 시각

중복 방지 기준:

```text
unique(store_id, phone)
```

### visits

방문 기록입니다.

- `id`: 방문 ID
- `store_id`: 매장 ID
- `customer_id`: 고객 ID
- `source`: `qr_checkin`, `owner_manual`
- `created_by`: `customer`, `owner`, `system`
- `visited_at`: 방문 시각
- `created_at`: 생성 시각

### messages

AI 메시지 초안 또는 발송 대기열입니다.

- `id`: 메시지 ID
- `store_id`: 매장 ID
- `customer_id`: 고객 ID
- `message_type`: `welcome`, `return_visit`, `manual`
- `channel`: `kakao`, `sms`
- `body`: 메시지 내용
- `status`: `draft`, `pending`, `approved`, `sent`, `failed`, `cancelled`
- `approved_at`: 승인 시각
- `sent_at`: 발송 시각
- `created_at`, `updated_at`: 생성/수정 시각

### send_logs

발송 성공/실패 로그입니다.

- `id`: 로그 ID
- `store_id`: 매장 ID
- `message_id`: 메시지 ID
- `channel`: `kakao`, `sms`
- `status`: `success`, `failed`
- `provider_message_id`: 외부 발송 서비스 메시지 ID
- `error_message`: 실패 사유
- `created_at`: 생성 시각

## RLS

모든 테이블은 RLS를 켭니다.

기본 정책:

- 점주는 본인 매장 데이터만 조회합니다.
- 고객 QR 등록처럼 공개 화면에서 쓰는 데이터 변경은 프론트에서 직접 테이블에 쓰지 않습니다.
- 고객 등록, 방문 추가, 메시지 대기열 생성은 이후 Supabase Edge Function에서 처리합니다.

## Migration File

초기 스키마 파일:

```text
supabase/migrations/001_initial_schema.sql
```
