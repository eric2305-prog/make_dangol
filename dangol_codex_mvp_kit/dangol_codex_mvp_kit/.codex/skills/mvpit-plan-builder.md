# MVPit Plan Builder

## Purpose
Convert domain documents into ordered, buildable vertical slices.

## Workflow
1. Read `CODEX.md`, `.codex/rules/architecture.md`, `.codex/rules/nextjs.md`, `.codex/rules/supabase.md`, and `docs/domains/*.md`.
2. Identify dependencies: auth, database schema, RLS, Edge Functions, UI routes, deployment, and test data.
3. Split work into vertical slices that can be implemented and verified independently.
4. Write the plan under `docs/plans/<kebab-name>.md`.

## Plan Template
```md
# Plan: <name>

## Goal
## Inputs
## Assumptions
## Ordered Items

### 1. <item>
Status: pending
Scope:
Implementation:
Verification:
Risks:

## Release Notes
## Open Questions
```

## Ordering Rules
- Schema/RLS before Edge Functions that depend on tables.
- Edge Function contracts before UI mutations that call them.
- Browser-visible UI verification on every user-facing slice.
