# Merchant Dashboard Domain

## Purpose

점주 대시보드는 매장 운영자가 QR, 고객, 방문, 메시지 상태를 최소한으로 확인하고 누락 방문을 보정하는 화면이다. 1차 MVP에서는 고급 CRM이 아니라 핵심 루프가 매장에서 돌아가는지 확인하는 운영 도구로 제한한다.

## MVP Scope

- 점주 로그인
- 점주/매장 생성
- 내 매장 QR 확인
- 고객 목록
- 이름/휴대폰 번호 검색
- 고객 상세
- 오늘 방문 처리
- 고객 이름/휴대폰 번호 수정
- 고객별 메시지 이력 확인

## Out Of Scope

- 고급 통계
- 캠페인 설정
- 쿠폰 관리
- VIP 태그
- 고객 메모
- 메시지 직접 발송
- 메시지 승인 기능
- 과거 날짜 방문 추가

## Screens

### Store Setup

```text
점주 로그인
→ 매장 없음
→ 점주/매장 생성
→ 매장 대시보드 진입
```

필드:

- owner name
- store name
- owner phone
- business type
- subscription status 기본값

### Store QR

```text
내 매장 QR
→ /s/{store_id} URL 표시
→ QR 이미지 표시
→ 복사/다운로드
```

### Customer List

```text
고객 목록
→ 이름/휴대폰 검색
→ 방문 횟수, 마지막 방문일, 상태 표시
→ 고객 상세 진입
```

### Customer Detail

```text
고객 상세
→ 기본 정보
→ 방문 횟수
→ 마지막 방문일
→ 평균 방문주기
→ 다음 예상 방문일
→ 오늘 방문 처리
→ 메시지 이력
```

### Manual Visit Correction

```text
고객 상세
→ 오늘 방문 처리 클릭
→ 중복 방문 확인
→ visit_logs 생성
→ customers 갱신
→ 성공/중복/실패 상태 표시
```

## Data Access

점주는 본인 매장의 데이터만 볼 수 있어야 한다.

권한 기준:

- `stores.owner_user_id = auth.uid()`
- customers 조회는 해당 store 소유자만 가능
- visit_logs 조회는 해당 store 소유자만 가능
- message_logs 조회는 해당 store 소유자만 가능

## Suggested Routes

```text
/dashboard
/dashboard/store
/dashboard/qr
/dashboard/customers
/dashboard/customers/[customerId]
/dashboard/messages
```

## UI States

- 로그인 필요
- 매장 없음
- 로딩
- 빈 고객 목록
- 검색 결과 없음
- 오늘 이미 방문 처리됨
- 저장 성공
- 저장 실패

## Verification

- 점주는 본인 매장의 고객만 볼 수 있다.
- 매장이 없는 점주는 store setup으로 이동한다.
- QR URL은 해당 매장 ID를 포함한다.
- 고객 검색은 이름 또는 휴대폰 번호로 동작한다.
- 오늘 방문 처리 후 고객 상세의 방문 횟수와 마지막 방문일이 갱신된다.
