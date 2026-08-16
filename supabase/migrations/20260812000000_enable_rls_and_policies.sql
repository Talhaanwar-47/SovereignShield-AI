-- STEP 17B — Enable RLS on drivers and vehicles (deny-by-default)
--
-- SCHEMA LIMITATION:
-- This repository does not contain CREATE TABLE migrations or an authoritative
-- remote schema dump for `drivers` / `vehicles`. Column shapes used by the
-- client are inferred only from TypeScript types and mappers
-- (src/types/driver.ts, src/types/fleet.ts, src/data/mappers.ts).
--
-- OWNERSHIP LIMITATION:
-- No user_id / owner_id / tenant_id (or equivalent) columns are evidenced in
-- the repository. Authentication is mock/demo only (no Supabase Auth identity).
-- Therefore this migration does NOT invent ownership policies and does NOT
-- grant broad access via USING (true) or TO anon.
--
-- SECURITY POSTURE:
-- Enable RLS (+ FORCE) with zero permissive policies = deny-by-default for
-- roles subject to RLS (anon / authenticated). Service role still bypasses RLS
-- for controlled server-side operations.
--
-- Production deployment requires Supabase Auth identity + ownership/tenant
-- policies before exposing real driver PII.
--
-- REQUIRED BEFORE PRODUCTION READ ACCESS:
-- 1. Add real Supabase Auth (or equivalent) end-user identity.
-- 2. Add an ownership/tenant column on drivers and vehicles
--    (e.g. user_id uuid REFERENCES auth.users(id), or tenant_id).
-- 3. Replace deny-by-default with least-privilege policies scoped to
--    auth.uid() / tenant membership — never USING (true) for PII tables.
-- 4. Apply this migration (and subsequent policy migrations) to the remote
--    Supabase project; client column-scoped selects alone are not a trust boundary.

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;

-- Intentionally no CREATE POLICY statements.
-- With RLS enabled and no permissive policies, anon/authenticated cannot read
-- or write rows. Do not add USING (true) or unrestricted TO anon policies.
