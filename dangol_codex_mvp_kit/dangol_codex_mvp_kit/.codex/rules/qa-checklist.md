# QA Checklist (Standard)

## Code
- Lint/typecheck/build run or clearly skipped with reason.
- No unrelated refactors.
- No secrets committed.
- No client-side service role usage.

## Supabase
- Migrations are additive and reviewable.
- RLS policies match the permission model.
- Edge Functions validate input and auth.
- Webhooks are idempotent and signature-checked when applicable.

## UI
- Desktop viewport checked.
- Mobile viewport checked.
- Loading, empty, and error states considered.
- No obvious overlap, overflow, or clipped text.

## Release
- Git status reviewed.
- Environment variables documented.
- Vercel deployment assumptions documented.
