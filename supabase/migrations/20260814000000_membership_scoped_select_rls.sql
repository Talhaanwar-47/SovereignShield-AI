-- STEP 18C-1 — Membership-scoped SELECT RLS (authenticated only)
--
-- Opens SELECT for organization members via is_org_member().
-- Does NOT add INSERT/UPDATE/DELETE policies.
-- Does NOT add anon policies.
-- Does NOT use USING (true).
-- Recursive RLS on organization_members is avoided via SECURITY DEFINER helper.

CREATE OR REPLACE FUNCTION public.is_org_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
-- Intentionally no EXECUTE grant to anon.

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS organization_members_select_same_org ON public.organization_members;
CREATE POLICY organization_members_select_same_org
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS drivers_select_org_member ON public.drivers;
CREATE POLICY drivers_select_org_member
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS vehicles_select_org_member ON public.vehicles;
CREATE POLICY vehicles_select_org_member
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- No INSERT/UPDATE/DELETE policies.
-- No anon policies.
-- Drivers/vehicles/organizations/organization_members remain RLS enabled + forced.
