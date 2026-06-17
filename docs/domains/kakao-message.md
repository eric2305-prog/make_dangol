# Kakao Message Domain

## Purpose

카카오 메시지 도메인은 고객 상태와 방문 데이터에 따라 메시지를 만들고, 카카오 발송 API를 호출한 뒤 성공/실패 로그를 남긴다. 1차 MVP의 핵심 가치는 점주가 직접 메시지를 작성하지 않아도 재방문 유도 메시지가 자동으로 발송되는 것이다.

## MVP Scope

- welcome 메시지 자동발송
- revisit 메시지 자동발송
- dormant 메시지 자동발송
- 템플릿 기반 메시지 생성
- `message_logs` pending/success/failed 저장
- 실패 사유 저장
- 최소 재시도 또는 실패 기록

## Out Of Scope

- 복잡한 캠페인 빌더
- 점주 메시지 승인 기능
- 쿠폰
- 링크 클릭 추적
- 고급 발송 통계
- 비용 상세 리포트
- 정교한 재시도 큐

## Message Types

| Type | Trigger | Goal |
|---|---|---|
| `welcome` | 신규 고객 등록 직후 | 등록 감사와 재방문 기대 형성 |
| `revisit` | 다음 예상 방문일 전후 | 재방문 유도 |
| `dormant` | 장기 미방문 기준 도달 | 휴면 방지 |

## Send Flow

```text
발송 대상 결정
→ 메시지 타입 결정
→ 템플릿으로 message_body 생성
→ message_logs pending 생성
→ 카카오 발송 API 호출
→ 성공 시 success, sent_at 저장
→ 실패 시 failed, error_message 저장
```

## Template Strategy

초기 MVP는 AI 생성보다 템플릿 기반을 우선한다.

예시:

- welcome: `{고객명}님, {매장명} 방문 감사합니다. 다음 방문도 기다릴게요.`
- revisit: `{고객명}님, {매장명} 다시 들르실 때가 가까워졌어요.`
- dormant: `{고객명}님, {매장명}에서 오랜만에 뵙고 싶어요.`

템플릿 변수:

- store name
- customer name
- visit count
- last visit date
- next expected visit date

## Data Model

### message_logs

필수 필드:

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

제약:

- `message_type in ('welcome', 'revisit', 'dormant')`
- `send_channel = 'kakao'`
- `send_status in ('pending', 'success', 'failed')`

## Backend Boundary

카카오 API 키와 발송 secret은 절대 클라이언트에 노출하지 않는다. 카카오 발송은 Supabase Edge Function이 담당한다.

추천 Edge Functions:

- `send-kakao-message`: 단일 메시지 발송
- `run-message-dispatch`: 발송 대상 조회 후 revisit/dormant 메시지 일괄 생성 및 발송

## Scheduling

1차 MVP에서는 아래 중 하나로 시작한다.

- Supabase Scheduled Functions
- Vercel Cron이 Supabase Edge Function 호출
- 운영자가 관리자 페이지에서 수동 트리거

초기 검증을 빠르게 하기 위해 `welcome`은 고객 등록 직후 동기 또는 짧은 비동기로 처리하고, `revisit/dormant`는 cron 기반 batch로 분리한다.

## Consent Rule

마케팅 수신 동의가 false인 고객에게 revisit/dormant 발송을 하지 않는다. welcome 메시지는 개인정보/서비스 이용 안내 성격인지, 마케팅성인지에 따라 발송 가능 범위를 별도 확인해야 한다. MVP에서는 안전하게 모든 카카오 자동발송은 `marketing_agreed = true` 고객으로 제한하는 정책을 우선한다.

## Verification

- 신규 등록 후 welcome `message_logs`가 생성된다.
- 카카오 API 성공 응답이면 `send_status = success`, `sent_at`이 저장된다.
- 실패 응답이면 `send_status = failed`, `error_message`가 저장된다.
- revisit/dormant 대상 조회가 동의하지 않은 고객을 제외한다.
- 클라이언트 번들에 카카오 secret이 포함되지 않는다.
