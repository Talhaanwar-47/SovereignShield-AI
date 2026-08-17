# SovereignShield AI

**AI-Powered Fleet Intelligence & Operations Platform**

SovereignShield AI is an AI-powered fleet intelligence and operations platform combining secure organization-level access control, deterministic compliance and operational intelligence, alert management, executive analytics, audit visibility, and a natural-language Gemini Copilot.

This is a **portfolio / demo application**. Several capabilities are intentionally simulated and clearly labeled. It is not a production compliance or government identity platform.

---

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Secure RBAC / RLS** | Supabase Auth + `organization_members` + PostgreSQL Row Level Security |
| **AI Identity Verification** | AI-assisted identity document OCR, structured identity extraction, and verification workflow |
| **Fleet Intelligence** | Vehicle/driver registry with role-scoped visibility |
| **Natural-Language AI Copilot** | Gemini via Supabase Edge Function (server-side API key) |
| **Operations Command Center** | Deterministic priority engine over fleet snapshot |
| **Alert & Incident Center** | Derived alerts from operational priorities (no fake incidents) |
| **Compliance & Risk Intelligence** | License expiry analysis; no invented risk scores |
| **Executive Analytics** | KPIs composed from deterministic engines |
| **Audit & Security Center** | Session-local audit event visibility |
| **Recruiter / Demo Experience** | Guided demo UX, role overview, honest capability labels |

---

## Architecture

```
Frontend (React + Vite)
        ↓
Supabase Auth (Google OAuth)
        ↓
Production organization membership  OR  Demo onboarding → Demo Organization
        ↓
organization_members + RLS
        ↓
RLS-scoped application data (drivers, driver_pii, vehicles)
        ↓
Deterministic intelligence engines (Operations, Alerts, Compliance, Analytics)
        ↓
Gemini Copilot via Edge Function (server-side GEMINI_API_KEY)
  Browser → JWT → gemini-copilot → auth + membership
  → server-trusted RLS-scoped snapshot → Gemini 3.6 Flash
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed flow diagrams.

---

## AI Architecture

- **Deterministic engines** calculate authoritative operational and compliance metrics (priorities, alerts, compliance status, executive KPIs).
- **Gemini** explains and summarizes a **server-trusted, RLS-scoped fleet snapshot** built by the Edge Function at request time. It does not perform authorization.
- Client-supplied production organization, role, driver, or vehicle identifiers are **not trusted**.
- Optional client demo telemetry is accepted only after validation against RLS-visible assets and is labeled simulated.
- **Gemini does not invent** unsupported operational facts (risk scores, live GPS, maintenance records, financial KPIs, etc.).
- **Simulated telemetry** (speed, battery, clearance status) is always labeled as simulated in system instructions and UI.
- **PII minimization**: Copilot context includes driver names and expiry dates only — never personal codes or license numbers.

---

## Security

| Layer | Mechanism |
|-------|-----------|
| Authentication | Supabase Auth (Google OAuth) |
| Authorization | `organization_members.role` + PostgreSQL RLS (authoritative) |
| Copilot access | JWT + org membership check in Edge Function |
| Copilot context | Server-trusted RLS-scoped snapshot (`snapshotVersion`, `snapshotCapturedAt`) |
| Gemini secret | `GEMINI_API_KEY` — Edge Function secret only, never in frontend |
| Demo provisioning | Backend RPC `provision_demo_membership` — production membership is not bypassed |
| PII | `driver_pii` table with role-aware RLS; Fleet Manager cannot access protected fields |
| Driver scope | Own driver row and assigned vehicles only |
| Rate limiting | 20 requests / 15 min / verified user (in-memory V1) |
| CORS | Origin allowlist (`localhost:5173` + `COPILOT_ALLOWED_ORIGINS`) |
| Audit | Session-local events; no sensitive field serialization |

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

The **Login screen role selector** (Admin / Fleet Manager / Driver) is **cosmetic / informational only**. It is never used for authorization.

Public **Demo onboarding** role selection applies only to the isolated Demo Organization through a backend RPC. Real authorization always comes from `organization_members.role` and RLS.

---

## Access models

### Production

Google Auth → production organization membership → real Admin / Fleet Manager / Driver role.

### Public Demo

Google Auth → Demo onboarding → Demo Organization → Demo Admin / Demo Fleet Manager / Demo Driver → same application experience → synthetic demo data.

- The Demo tenant (`SovereignShield Demo`) is isolated from production organizations (`SovereignShield Fleet`).
- Demo data is synthetic fixtures, not production fleet data.
- Demo users do not receive production organization access.
- Role selection applies only to the Demo Organization.
- Demo onboarding supports many independent authenticated users, subject to normal platform and infrastructure limits.

---

## Demo Limitations

The following are **not** production capabilities:

- Vehicle telemetry (speed, battery, clearance) is **simulated** — not live GPS or IoT feeds
- **Live GPS** is not provided
- **Driver risk scores** are not implemented
- **Historical audit persistence** is not implemented (session-local only)
- **Maintenance records** are simulated/derived only where explicitly labeled
- **Smart-ID / Mobile-ID** login is mock-only (Google OAuth is real)
- Demo **fallback data** is used when Supabase is unavailable — labeled "Demo Fallback"
- **Government identity verification** is not performed (local OCR assessment only)
- Demo data is **not** production fleet data
- The public Demo tenant is isolated; demo membership does not grant production organization access
- This project does **not** claim SOC 2, ISO, GDPR, or production security certification
- CI does **not** deploy production; infrastructure capacity is not unlimited

---

## Setup

### Requirements

- **Node.js** 20+ (required; Vite 8 / locked toolchain. No `engines` field in `package.json`)
- **npm** (bundled with Node.js 20; local install uses `npm install`, CI uses `npm ci`)
- Supabase project with migrations applied
- Google Gemini API key (Edge Function secret)

### Install

```bash
npm install
```

### Environment variables

Copy the example file:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes (live data / Copilot) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes (live data / Copilot) | Supabase anon/public key |

**Server-side secrets** (set via Supabase CLI or Dashboard — **never** in Vite `.env`):

| Secret | Purpose |
|--------|---------|
| `GEMINI_API_KEY` | Google Gemini API key for Copilot |
| `COPILOT_ALLOWED_ORIGINS` | Production frontend origin(s), comma-separated |

### Supabase configuration

1. Apply migrations in `supabase/migrations/` to your Supabase project (includes the isolated Demo Organization and `provision_demo_membership` RPC).
2. Enable **Google** provider in Authentication → Providers.
3. Add redirect URLs (e.g. `http://localhost:5173/`) in Authentication → URL Configuration.
4. Seed production `SovereignShield Fleet` memberships for real Admin / Fleet Manager / Driver users. Authenticated visitors without production membership use Demo onboarding.

### Gemini / Copilot configuration

```bash
supabase secrets set GEMINI_API_KEY=<your-server-side-key>
supabase secrets set COPILOT_ALLOWED_ORIGINS=https://your-production-domain
supabase functions deploy gemini-copilot
```

---

## Development

```bash
npm run dev      # Start Vite dev server (http://localhost:5173)
npm test         # Vitest unit tests
npm run lint     # ESLint
npm run build    # TypeScript check + production build
npm run preview  # Preview production build
```

---

## CI

GitHub Actions workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) is a **quality gate**. It does **not** deploy production.

Runs on:

- `push` to `main`
- `pull_request` to `main`

Pipeline (Node.js 20, `npm` cache, `permissions: contents: read`):

```bash
npm ci
npm test
npm run lint
npm run build
```

Failing tests, lint, or build fail the workflow. Supabase database migrations and Edge Function deployment remain **explicit / manual** operations.

---

## Deployment

**Do not commit secrets.** There is no automated production deployment. Deploy the frontend to any static host (Vite build output in `dist/`).

Edge Function deployment (manual):

```bash
supabase link --project-ref <your-project-ref>
supabase secrets set GEMINI_API_KEY=<placeholder>
supabase secrets set COPILOT_ALLOWED_ORIGINS=https://your-production-domain
supabase functions deploy gemini-copilot
```

Ensure all RLS migrations are applied before exposing the anon key in the browser.

---

## Project Structure

```
src/
├── App.tsx                    # Auth session + profile + demo onboarding
├── Login.tsx                  # Google OAuth + cosmetic role selector
├── DashboardLayout.tsx        # Main shell, tabs, fleet, Copilot terminal
├── components/
│   ├── OperationsCommandCenter.tsx
│   ├── AlertIncidentCenter.tsx
│   ├── ComplianceRiskIntelligence.tsx
│   ├── ExecutiveAnalytics.tsx
│   ├── AuditSecurityCenter.tsx
│   ├── DemoModeBanner.tsx
│   ├── DemoOnboarding.tsx     # Public recruiter demo role selection
│   ├── DemoRoleSwitch.tsx     # Demo-org-only role switch (RPC)
│   └── demo/                  # Recruiter/demo UX panels
├── constants/
│   └── demoOrganization.ts    # Demo vs production tenant identifiers
├── services/
│   ├── authSession.ts         # Supabase Auth helpers
│   ├── authProfile.ts         # organization_members profile
│   ├── demoProvisioning.ts    # provision_demo_membership RPC client
│   ├── fleetService.ts        # RLS-scoped fleet reads + fallback
│   ├── geminiCopilot.ts       # Edge Function client (single invoke, 46s)
│   ├── geminiCopilotHelpers.ts
│   ├── operationsPriorityEngine.ts
│   ├── alertIncidentService.ts
│   ├── complianceEngine.ts
│   ├── executiveAnalyticsEngine.ts
│   ├── auditEventService.ts
│   └── ocrService.ts          # Browser Tesseract OCR
├── data/                      # Fallback demo records, mappers
├── types/                     # Shared TypeScript types
└── utils/                     # OCR parser, isikukood validation, matching

supabase/
├── migrations/                # RLS policies, org schema, driver_pii, demo tenant
├── functions/gemini-copilot/  # Server-side Gemini proxy + trusted context
└── config.toml

.github/workflows/
└── ci.yml                     # Quality gate: test, lint, build (no deploy)

docs/
├── ARCHITECTURE.md
└── SECURITY.md
```

---

## Tech Stack

- React 19, TypeScript, Vite 8, Tailwind CSS 4
- Supabase (Auth, Postgres, Edge Functions)
- Google Gemini (`gemini-3.6-flash`, pinned)
- Tesseract.js (browser OCR)
- Recharts (analytics charts)
- Vitest + ESLint

---

## License

Private portfolio project.
