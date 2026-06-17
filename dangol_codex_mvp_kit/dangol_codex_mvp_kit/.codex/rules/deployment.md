# Deployment Rules (Standard)

Every finished product documents its deployment assumptions here. Fill in the project-specific values; the rules themselves are universal.

## GitHub
- Remote: `<your-git-remote>` (e.g. `git@github.com:<owner>/<repo>.git`)
- Default branch: `main`
- Prefer feature branches for substantial changes.

## Vercel
- Connect the GitHub repository to Vercel.
- Pushes to the production branch should trigger deployment.
- Keep all required environment variables documented in this file.

## Environment Variables
- Public (safe for the browser, `NEXT_PUBLIC_*`):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Server-only (never `NEXT_PUBLIC_`, never in client code):
  - Supabase service role key
  - External API secrets
