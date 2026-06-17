# Codex 시작 프롬프트

아래 지침으로 단골만들기 1차 MVP 작업을 시작해줘.

1. `CODEX.md`를 먼저 읽어.
2. `docs/brief.md`를 읽어.
3. `.codex/rules/architecture.md`, `.codex/rules/nextjs.md`, `.codex/rules/supabase.md`를 읽어.
4. 아직 코드를 수정하지 말고, 먼저 아래 산출물을 만들어줘.

필요 산출물:

- `docs/domains/customer-registration.md`
- `docs/domains/visit-checkin.md`
- `docs/domains/kakao-message.md`
- `docs/domains/merchant-dashboard.md`
- `docs/domains/admin-ops.md`
- `docs/plans/dangol-mvp-plan.md`

계획은 반드시 vertical slice 단위로 나눠줘.

1차 MVP 필수 범위:

- 점주/매장 생성
- 매장 QR 생성
- 고객 휴대폰 번호 기반 등록
- `store_id + phone` 신규/기존 고객 분기
- 기존 고객 방문 체크인
- 방문주기 단순 계산
- 카카오톡 자동발송
- 발송 성공/실패 로그
- 점주 대시보드
- 운영 통제용 최소 관리자 페이지

제외할 것:

- POS 연동
- 카카오 인증 기반 고객 식별
- 쿠폰
- 링크 클릭 추적
- VIP 태그
- 고객 메모
- 고급 통계
- 복잡한 캠페인 빌더
- 점주 메시지 승인 기능

결과 보고에는 다음을 포함해줘.

- 만든 문서 목록
- 구현 순서
- 가장 먼저 구현할 1번 항목
- Supabase 보안/RLS 주의점
- 카카오톡 발송 연동 위험요소
