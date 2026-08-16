# SovereignShield AI — Security

This document describes threat boundaries, authentication, authorization, PII handling, and known demo limitations.

**This project does not claim SOC 2, ISO 27001, GDPR certification, or any compliance accreditation.**

---

## Threat Boundaries

| Boundary | Trust level | Notes |
|----------|-------------|-------|
| Browser (React SPA) | Untrusted | Anon key is public; all data access must pass RLS |
| Supabase Auth JWT | Trusted identity | Verified by Edge Function via `auth.getUser()` |
| PostgreSQL + RLS | Authoritative authorization | Role-aware SELECT policies |
| Edge Function | Trusted server | Holds `GEMINI_API_KEY`; enforces membership |
| Google Gemini API | Third-party processor | Receives prompts + authorized context only |

---

## Authentication

- **Provider:** Supabase Auth with Google OAuth (real).
- **Mock methods:** Smart-ID and Mobile-ID are UI-only simulations — they do not create sessions.
- **Session:** Supabase-managed JWT; auto-refresh handled by client.
- **Edge Function gateway:** `verify_jwt = true` in `supabase/config.toml`.
- **Edge Function handler:** Additional `auth.getUser(bearer)` — rejects invalid/expired tokens.

---

## Authorization

### Source of truth

```
Auth (JWT) → organization_members → RLS → application data
```

### Role selector on Login screen

**Cosmetic / informational only.** Never sent to App, profile, Copilot, or provisioning. Real production role comes from `organization_members.role` loaded via RLS in `authProfile.ts`.

### Demo onboarding role selection

Applies **only** to the isolated Demo Organization through the backend `provision_demo_membership` RPC. Client role selection alone is never sufficient. Production membership is not bypassed.

### Role-aware access

| Capability | Admin | Fleet Manager | Driver |
|------------|-------|---------------|--------|
| All org drivers | Yes | Yes | Own row only |
| Driver PII (`personalCode`, `licenseNumber`) | Yes | **No** | Own only |
| All org vehicles | Yes | Yes | Assigned only |
| Copilot invoke | Yes (org member) | Yes | Yes |
| Audit (full) | Yes | Yes | Filtered subset |

### Copilot authorization

- Requires valid JWT **and** at least one `organization_members` row.
- **Does not** trust body fields: `role`, `organization_id`, `driver_id`, `vehicle_id`, or other client-supplied production identifiers.
- Uses user-scoped anon client (never service role) for membership probe and RLS-scoped fleet reads.
- Builds a **server-trusted request-time fleet snapshot** (`snapshotVersion`, `snapshotCapturedAt`) from database facts.
- Optional client demo telemetry is validated against RLS-visible asset IDs only; assignments and license expiry remain server-authoritative.
- Org-wide Copilot access for all member roles (not role-scoped at Edge layer). Context content is still RLS-scoped (Driver sees own rows).

### Frontend authorization assumptions

- UI gates PII display and audit filtering by `membershipRole`.
- These are **UX supplements** — RLS remains authoritative.
- Authenticated users without membership are offered Demo onboarding (not production access). Copilot still requires membership; unauthenticated or non-member invokes return 401/403.

---

## Row Level Security (RLS)

- RLS **enabled and forced** on `drivers`, `vehicles`, `driver_pii`, `organizations`, `organization_members`.
- Deny-by-default: no policies until membership-scoped policies applied.
- Helpers: `is_org_member()`, `is_org_role()` — SECURITY DEFINER, `anon` execute revoked.
- **No write policies** on application tables for client roles — reads only. Demo membership writes go exclusively through `provision_demo_membership` (SECURITY DEFINER).
- Migrations tested statically in `roleAwareRls.migration.test.ts`, `contractDriverPii.migration.test.ts`, and `demoOrganization.migration.test.ts`.

### Known gap

No live Postgres integration tests verify cross-org isolation at runtime. Static migration analysis + mocked client tests provide regression coverage.

---

## PII Minimization

| Data | Storage | Copilot | UI |
|------|---------|---------|-----|
| Driver name | `drivers.name` | Included | Shown |
| Personal code | `driver_pii.personal_code` | **Never** in normal paths | Admin/Driver only |
| License number | `driver_pii.license_number` | **Never** in normal paths | Admin/Driver only |
| License expiry | `drivers.expiry_date` | Name + expiry only | Shown |
| OCR extracted fields | Browser memory | Not sent to Gemini | Identity tab only |

### Copilot context builders

- Gemini receives context from Edge `buildTrustedCopilotContext()` over RLS-scoped database rows — not a client-authoritative payload.
- Client helpers (`buildFleetCopilotContext`, engine-specific builders) assemble UI / local fast-path context and optional demo telemetry. They strip PII by design.
- System instructions explicitly forbid personal codes and license numbers.

### Logging

- **Frontend:** No `console.log` / `console.error` in production source.
- **Edge Function:** Structured `console.error` with `redactSensitiveLogText()` — redacts Bearer tokens, API keys, 11-digit codes, license patterns.
- **Audit events:** Serialization excludes PII, tokens, prompts.

---

## Gemini Security

| Control | Implementation |
|---------|----------------|
| API key location | `GEMINI_API_KEY` — Supabase Edge secret only |
| Frontend exposure | Verified absent (`geminiCopilot.test.ts`) |
| Auth before upstream | JWT + org membership required |
| Rate limiting | 20 req / 15 min / verified `userId` |
| CORS | Allowlist only — never `*` |
| Retry | 3 total Gemini attempts (up to 2 transient retries); exponential backoff with jitter; Retry-After honored where applicable |
| Edge deadline | 40s overall (`GEMINI_UPSTREAM_TIMEOUT_MS`) covering all attempts + backoff |
| Client timeout | 46s (`COPILOT_INVOKE_TIMEOUT_MS`) — one invoke, no client-side retry loop |
| Permanent errors | No retry for 400/401/403/404 or timeouts/aborts |
| Error classification | `upstream_gemini`, `upstream_timeout`, `empty_gemini_response`, `edge_error`, `invoke_timeout`, `invoke_network`, `invoke_http` |
| User-facing errors | Sanitized — no stack traces, raw Gemini errors, or API keys |

### AI honesty rules

Gemini system instructions prohibit inventing:

- Driver risk scores
- Maintenance records / work orders
- Live GPS or real-time tracking claims
- Accidents or incidents
- License numbers or personal codes
- Historical audit events
- Financial KPIs
- Unsupported fleet metrics

Simulated telemetry must always be described as simulated.

### Remaining Copilot context boundary

The Edge Function builds Gemini context from RLS-scoped database reads at request time. Client-supplied production organization, role, driver, or vehicle identifiers are ignored.

Optional `clientDemoTelemetry` (simulated clearance labels) is accepted only for asset IDs the caller can already see via RLS. It cannot expand access, override server-trusted assignments or license expiry, or inject unauthorized vehicles. Simulated clearance is labeled as simulated telemetry — not live GPS or production IoT.

The browser issues exactly one Copilot invoke per submission. Transient Gemini retries stay inside the Edge Function.

---

## Demo Access

- Public visitors authenticate with Google, then choose a demo role on Demo onboarding.
- Membership is created only by the `provision_demo_membership` SECURITY DEFINER RPC (backend-controlled).
- Production organization members cannot use demo provisioning.
- Role selection applies only to the isolated Demo Organization (`SovereignShield Demo`).
- Demo users do not receive production organization (`SovereignShield Fleet`) access.
- Demo fleet data and demo `driver_pii` are synthetic fixtures — never copied from production.
- RLS remains authoritative; demo isolation is tenant-scoped via `organization_id`.
- Login screen role tabs remain cosmetic and are never used as authorization.
- Demo onboarding supports many independent authenticated users, subject to normal platform and infrastructure limits (not unlimited capacity).

---

## Secret Management

| Secret | Location | Committed? |
|--------|----------|------------|
| `VITE_SUPABASE_URL` | `.env` (client-safe) | No (`.gitignore`) |
| `VITE_SUPABASE_ANON_KEY` | `.env` (client-safe) | No |
| `GEMINI_API_KEY` | Supabase Edge secrets | No |
| `COPILOT_ALLOWED_ORIGINS` | Supabase Edge secrets | No |

- `.env.example` uses placeholders only.
- README and docs use `<placeholder>` values — never real secrets.

---

## Audit Behavior

- Events stored **session-local** in browser memory.
- Categories: Authentication, Copilot, Membership, OCR, System.
- Copilot failures tagged with `client-gemini-copilot:{failureKind}`.
- **Not persisted** to database — historical audit trail is a demo limitation.
- Driver viewers see filtered events via `filterAuditEventsForViewer()`.

---

## Rate Limiting

- **Scope:** `gemini-copilot` Edge Function only.
- **Key:** Verified JWT `userId` (never body identity).
- **Limit:** 20 requests per 15-minute window.
- **Storage:** In-memory `Map` — resets on isolate cold start; not shared across Edge instances.

**Production note:** Persistent rate limiting (Redis/DB) recommended for multi-instance deployments.

---

## CORS

- Allowed origins: `http://localhost:5173` (always) + `COPILOT_ALLOWED_ORIGINS` env.
- Untrusted `Origin` header → 403.
- Requests without `Origin` (server-to-server) bypass CORS but still require JWT + membership.

---

## Error Handling

Users never see:

- Stack traces
- Raw Gemini API error bodies
- API keys or JWT tokens
- Database internals or SQL errors

Server-side Edge logs retain diagnostic metadata (HTTP status, retry attempt) without prompts, PII, or secrets.

---

## Known Demo Limitations

These are **not security defects** but honest capability boundaries:

| Limitation | Impact |
|------------|--------|
| Simulated telemetry | Not real IoT/GPS data |
| No driver risk scores | Cannot assess driver risk |
| Session-local audit | No persistent audit trail |
| Demo fallback data | Shown when Supabase unavailable |
| Local OCR only | Not government identity verification |
| In-memory rate limits | Not durable across Edge instances |
| No live RLS integration tests | Static/mocked test coverage only |
| No automated production deploy | CI is a quality gate only |

---

## Dependency Security Notes

- `@supabase/supabase-js` — official Supabase client
- `tesseract.js` — browser OCR (WASM)
- `recharts` — chart rendering
- `lucide-react` — icons

No suspicious or duplicate libraries identified. Package upgrades not performed in this hardening pass.
