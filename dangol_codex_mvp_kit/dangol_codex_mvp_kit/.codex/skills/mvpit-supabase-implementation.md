# MVPit Supabase Implementation

## Purpose
Handle Supabase work with current-docs discipline and security-first defaults.

## Workflow
1. Read `CODEX.md`, `.codex/rules/supabase.md`, and relevant domain/plan docs.
2. Verify current command syntax with `supabase --help` or official docs when needed.
3. Classify the work: Auth/session, migration/schema, RLS/policies, Edge Function, Storage, Realtime, Next.js integration.
4. Design the access boundary before coding.
5. Implement with additive migrations and explicit verification.
6. Review SQL/schema/RLS changes.

## Security Checklist
- Never expose `service_role`, secret keys, or private API keys to browser code.
- Never use user-editable metadata for authorization decisions.
- Enable RLS on exposed-schema tables and create policies that match the actual access model.
- Keep secrets in Edge Functions or server-only code.
- Validate Edge Function inputs with Zod or equivalent.
- Handle CORS and auth explicitly.

## Migration Rules
- Prefer `supabase migration new <name>` for new migration files.
- Do not edit migrations that may already be applied in shared or deployed environments.
- Include constraints, foreign keys, delete behavior, timestamps, and useful comments.

## Report
Include changed Supabase surfaces, security decisions, verification run, and required deployment steps.
