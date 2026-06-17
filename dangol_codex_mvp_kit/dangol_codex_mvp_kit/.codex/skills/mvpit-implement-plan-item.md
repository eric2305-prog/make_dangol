# MVPit Implement Plan Item

## Purpose
Implement exactly one plan item as a vertical slice, then verify it.

## Workflow
1. Read `CODEX.md`, the relevant `docs/plans/*.md`, and domain docs.
2. Inspect existing code before editing.
3. Classify the slice: Next.js only, Supabase only, Fullstack, UI/responsive only.
4. Implement the smallest complete slice that satisfies the plan item.
5. Follow `.codex/rules/nextjs.md` and `.codex/rules/supabase.md`.
6. Run available checks: lint, typecheck, tests, build, or narrow equivalent.
7. For UI changes, verify desktop and mobile.
8. Before committing or deploying, run release review.

## Implementation Rules
- Keep changes scoped to the selected plan item.
- Do not combine unrelated plan items.
- Add loading, empty, error, and success states for user-facing flows when relevant.
- Use Supabase Edge Functions for privileged data access, business logic, webhooks, and external secrets.
- Never expose service role keys to browser code.
- Prefer new migrations over editing applied migrations.

## Completion Report
Include changed files, verification run, browser checks, bugs fixed, and remaining risks.
