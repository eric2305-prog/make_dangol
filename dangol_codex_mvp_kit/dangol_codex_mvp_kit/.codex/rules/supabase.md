# Supabase Rules (Standard)

## Auth
- Use Supabase Auth for user identity.
- Keep session handling centralized.
- Never expose service role keys to browser code.

## Postgres
- Use migrations for schema changes; prefer additive migrations over editing applied ones.
- Every user/domain table should have primary keys, timestamps, explicit foreign keys, indexes for hot filters, and comments where intent is not obvious.
- Enable RLS for public tables and write policies intentionally.
- Prefer text with check constraints over hard-to-evolve enum types unless there is a strong reason.

## Edge Functions
- Treat Edge Functions as the backend boundary for privileged data access, business logic, webhooks, and external secrets.
- Validate inputs with Zod or an equivalent schema.
- Handle CORS and auth explicitly.
- Use environment variables for secrets.
- Return only the fields the UI needs.

## Review Focus
- RLS enabled with no policy
- Overly broad policies (`using (true)` without justification)
- Client code using service role secrets
- Missing input validation
- Webhook idempotency and signature verification
- Direct client access that bypasses intended backend boundaries
