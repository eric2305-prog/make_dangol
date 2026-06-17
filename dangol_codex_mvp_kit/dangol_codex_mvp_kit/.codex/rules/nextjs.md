# Next.js Rules (Standard)

## Defaults
- Use the App Router.
- Prefer server components by default.
- Use client components only for browser state, events, effects, or interactive UI.
- Keep route segments, layouts, loading states, and error states explicit.
- Keep server-only code out of client bundles.

## Data and Actions
- Do not place secrets in client components.
- Validate form and API inputs with schemas (Zod or equivalent).
- Keep mutations behind server actions, route handlers, or Supabase Edge Functions depending on the trust boundary.

## UI
- Implement mobile and desktop layouts together.
- Ensure text fits within controls and cards at small widths.
- Add loading, empty, error, and success states for user-facing workflows.
- Prefer accessible native controls and semantic HTML.

## Verification
- Run lint/typecheck/build when available.
- For UI changes, start the local app and inspect at least one desktop and one mobile viewport.
