# Kakao Message Integration Risks

## Purpose

카카오톡 자동발송은 단골만들기 1차 MVP의 핵심 가치다. 다만 카카오 발송은 API 방식, 템플릿 승인, 동의 정책, 장애 대응에 따라 구현 리스크가 커질 수 있으므로 초기부터 위험요소를 분리해 관리한다.

## Integration Options

1차 MVP에서 선택 가능한 방식:

- 카카오 알림톡
- 카카오 친구톡
- 카카오 비즈메시지 대행사 API

선택 기준:

- 발신 프로필 생성 가능 여부
- 템플릿 승인 필요 여부
- 마케팅성 메시지 발송 가능 여부
- 개발 API 문서와 테스트 환경 제공 여부
- 발송 성공/실패 callback 또는 polling 지원 여부
- 비용과 월 발송량 제한

## Core Risks

### Template Approval

알림톡은 템플릿 사전 승인이 필요할 수 있다. welcome, revisit, dormant 메시지 문구가 즉시 발송되지 못할 수 있으므로 MVP 초기에 승인 가능한 문구와 대체 발송 방식을 정한다.

### Consent And Legal Constraints

revisit/dormant 메시지는 마케팅성으로 해석될 가능성이 높다. MVP에서는 `marketing_agreed = true` 고객만 자동발송 대상으로 삼는다.

추가 확인 필요:

- 야간 발송 제한
- 수신 거부 문구 필요 여부
- 개인정보 처리방침과 마케팅 수신 동의 문구
- 알림톡과 친구톡의 발송 가능 범위 차이

### Secret Exposure

카카오 API key, sender key, 대행사 secret은 Supabase Edge Function 환경변수에만 둔다. Next.js client component, public env, 브라우저 번들, 로그에 노출하지 않는다.

### Failure Handling

외부 API 장애, 템플릿 불일치, 잘못된 휴대폰 번호, 수신 불가, 잔액 부족 등으로 발송 실패가 발생할 수 있다.

MVP 처리 기준:

- 발송 전 `message_logs.send_status = 'pending'`
- 성공 시 `success`, `sent_at` 저장
- 실패 시 `failed`, `error_message` 저장
- 관리자 페이지에서 실패 로그 확인
- 정교한 재시도 큐는 제외하되 단순 재시도 여지는 남긴다

### Duplicate Sends

cron 또는 batch 재실행으로 같은 고객에게 같은 메시지가 반복 발송될 수 있다.

MVP 방어 기준:

- welcome은 고객 등록 트랜잭션과 연결해 고객당 1회만 생성
- revisit/dormant는 `customer_id + message_type + 기준일` 수준의 중복 방지 정책 마련
- 실패 재시도 시 기존 pending/failed 로그를 어떻게 처리할지 명시

### Cost Control

카카오 발송은 건당 비용이 발생할 수 있다.

MVP 최소 통제:

- 오늘 발송 수 관리자 화면 표시
- 오늘 실패 수 관리자 화면 표시
- store별 발송량 확인
- 과도한 발송량은 관리자 대응

## Recommended MVP Approach

1. welcome 자동발송을 먼저 구현한다.
2. `message_logs` pending/success/failed 흐름을 완성한다.
3. 실제 카카오 API가 준비되지 않았으면 provider adapter를 두고 sandbox/mock provider로 로그 흐름을 검증한다.
4. 카카오 승인/계정/템플릿이 준비되면 provider만 실제 API로 교체한다.
5. revisit/dormant는 batch dispatch로 분리한다.

## Verification Checklist

- 신규 등록 후 welcome pending log가 생성되는가?
- 성공 응답이면 success와 sent_at이 저장되는가?
- 실패 응답이면 failed와 error_message가 저장되는가?
- 마케팅 미동의 고객이 revisit/dormant 대상에서 제외되는가?
- 같은 고객에게 같은 welcome이 중복 생성되지 않는가?
- 클라이언트 번들에 카카오 secret이 포함되지 않는가?
- 관리자 페이지에서 실패 로그를 확인할 수 있는가?
