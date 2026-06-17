# Supabase Setup

## Apply Schema

1. Supabase 대시보드에서 프로젝트를 엽니다.
2. `SQL Editor`로 이동합니다.
3. `supabase/migrations/001_initial_schema.sql` 내용을 붙여 넣습니다.
4. `Run`을 누릅니다.

## Vercel Environment Variables

Supabase 연결에는 아래 공개 값이 필요합니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Supabase 위치:

```text
Project Settings > API
```

주의:

- `service_role` 키는 브라우저나 Vercel 공개 환경변수에 넣지 않습니다.
- 고객 등록 mutation은 Edge Function에서 처리합니다.
