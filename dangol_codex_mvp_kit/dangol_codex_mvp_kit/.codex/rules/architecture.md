# Architecture (Standard)

## Stack
- Next.js App Router + TypeScript
- Supabase Auth, Postgres, Edge Functions
- Vercel (hosting/deploy), GitHub (source)

## Boundaries
- Client components handle UI interactions only.
- Server components and route handlers handle server-rendered data and server-only operations.
- Supabase Edge Functions own backend business operations, privileged database access, external API calls, and webhooks.
- Postgres owns relational integrity, indexes, constraints, and RLS defense-in-depth.

## Default Feature Shape
1. Domain requirement
2. Data model and permission model
3. Edge Function contract if backend logic is needed
4. Next.js UI and route integration
5. Tests and browser verification
