# 단골만들기 MVP — Codex Operating Manual

이 문서는 Codex가 `단골만들기` 1차 MVP를 구현할 때 따라야 할 기준 문서입니다.

## 프로젝트 핵심

단골만들기는 점주가 QR로 고객 정보를 모으면, 고객 방문 기록을 기반으로 메시지를 생성하고 카카오톡으로 자동 발송해 재방문을 유도하는 소상공인용 리텐션 SaaS입니다.

핵심 루프:

```text
QR로 고객을 모은다
→ 방문 데이터를 쌓는다
→ 고객 상태에 맞는 메시지를 만든다
→ 카카오톡으로 자동 발송한다
→ 재방문을 유도한다
```

## 핵심 용어

| 용어 | 의미 |
|---|---|
| 점주 | 서비스를 사용하는 소상공인 / 매장 운영자 / 결제 주체 |
| 고객 | 점주의 매장에 방문해 QR로 등록하는 손님 |
| 관리자 | 단골만들기 운영자 |

## 1차 MVP 필수 범위

- 점주/매장 생성
- 매장별 QR URL 생성
- 고객 휴대폰 번호 기반 등록
- `store_id + phone` 기준 신규/기존 고객 분기
- 기존 고객 QR 체크인
- 방문주기 단순 계산
- 카카오톡 자동발송
- 발송 성공/실패 로그
- 점주 대시보드
- 운영 통제용 최소 관리자 페이지

## 1차 MVP 제외 범위

- POS 연동
- 카카오 인증 기반 고객 식별
- 쿠폰 시스템
- 링크 클릭 추적
- VIP 태그
- 고객 메모
- 고급 통계
- 복잡한 캠페인 빌더
- 점주 메시지 승인 기능

## 기술 스택

- Next.js App Router + TypeScript
- Supabase Auth, Postgres, Edge Functions
- Vercel
- GitHub

## 필수 규칙

작업 전 관련 규칙을 읽습니다.

| 파일 | 적용 영역 |
|---|---|
| `.codex/rules/architecture.md` | 전체 구조와 경계 |
| `.codex/rules/nextjs.md` | Next.js App Router, 서버/클라이언트 경계 |
| `.codex/rules/supabase.md` | DB, Auth, RLS, Edge Functions |
| `.codex/rules/design.md` | UI, 반응형, 접근성 |
| `.codex/rules/qa-checklist.md` | 검증 기준 |
| `.codex/rules/deployment.md` | 배포, 환경변수, Vercel |

## 구현 원칙

- 한 번에 하나의 vertical slice만 구현합니다.
- 관련 없는 리팩토링을 하지 않습니다.
- service role key, 외부 API key, 카카오 secret은 절대 클라이언트에 노출하지 않습니다.
- public table에는 RLS를 켭니다.
- 사용자 입력은 Zod 또는 동등한 방식으로 검증합니다.
- 방문 기록과 메시지 로그는 운영 판단의 핵심 데이터이므로 반드시 남깁니다.
- 고객 식별은 1차에서 `store_id + phone`입니다.
- 카카오톡 자동발송은 1차 MVP 핵심 기능입니다.

## 추천 작업 순서

1. `docs/brief.md`를 읽고 도메인 문서 작성
2. 도메인을 구현 계획으로 분해
3. DB 스키마/RLS 구현
4. QR 고객 등록/기존 고객 체크인 구현
5. 방문주기 계산 구현
6. 카카오톡 자동발송 함수 구현
7. 점주 대시보드 구현
8. 관리자 페이지 구현
9. UI/보안/릴리즈 리뷰

## 완료 보고 형식

```text
- 구현한 기능
- 변경 파일
- DB/Edge Function 변경 여부
- 실행한 검증
- 브라우저 확인 여부
- 남은 위험
- 다음 추천 작업
```
