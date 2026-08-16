-- STEP 18C-3 — Harden is_org_member EXECUTE Permission
--
-- Defense-in-depth: explicitly revoke EXECUTE from anon.
-- Does NOT alter function body, tables, or RLS policies.
-- Does NOT perform DML.

REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM anon;

-- Keep PUBLIC execution revoked.
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;

-- Keep EXECUTE for authenticated.
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
