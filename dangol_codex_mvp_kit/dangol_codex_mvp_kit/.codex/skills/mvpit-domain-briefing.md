# MVPit Domain Briefing

## Purpose
Turn rough planning input into durable domain documents under `docs/domains/`.

## Workflow
1. Read `CODEX.md`, `docs/brief.md`, and existing `docs/domains/*.md`.
2. Extract domains from the input. Prefer product concepts over technical layers.
3. For each domain, write or update one document in `docs/domains/`.
4. Capture business rules, roles, workflows, data concepts, UI surfaces, permissions, and open questions.
5. Do not invent firm requirements when the brief is ambiguous. Mark assumptions and questions clearly.

## Domain Template
```md
# Domain: <name>

## Purpose
## Users And Roles
## Core Workflows
## Business Rules
## Data Concepts
## Auth And Permissions
## UI Surfaces
## Integrations
## Open Questions
```
