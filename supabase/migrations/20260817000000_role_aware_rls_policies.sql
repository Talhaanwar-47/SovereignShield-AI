-- STEP 18E-5 — Migration 2 ONLY: Role-aware RLS (Approach C)
--
-- Introduces is_org_role() and replaces membership-wide SELECT policies with
-- admin / fleet-manager / driver matrices.
--
-- CRITICAL:
-- - Keeps is_org_member(uuid) unchanged.
-- - Does NOT drop drivers.personal_code / drivers.license_number (expand window).
-- - Does NOT assign drivers.user_id or vehicles.assigned_driver_id.
-- - Does NOT invent UUIDs or create auth users.
-- - No INSERT/UPDATE/DELETE policies. No anon policies. No USING (true).
-- - No service_role usage for user authorization.
-- - organizations_select_member remains is_org_member(id) (all members need org name).

-- ---------------------------------------------------------------------------
-- 1) Role helper (auth.uid() only — never client identity parameters)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_org_role(
  p_organization_id uuid,
  p_roles text[]
)
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
      AND om.role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_role(uuid, text[]) FROM PUBLIC;
-- Defense-in-depth: explicit anon revoke (same pattern as is_org_member STEP 18C-3).
REVOKE EXECUTE ON FUNCTION public.is_org_role(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_org_role(uuid, text[]) TO authenticated;
-- Intentionally no EXECUTE grant to anon.

-- is_org_member(uuid) intentionally left unchanged.

-- ---------------------------------------------------------------------------
-- 2) organization_members — self + staff (admin/fleet-manager); no peer enum for drivers
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS organization_members_select_same_org ON public.organization_members;

DROP POLICY IF EXISTS organization_members_select_self ON public.organization_members;
CREATE POLICY organization_members_select_self
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS organization_members_select_staff ON public.organization_members;
CREATE POLICY organization_members_select_staff
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (public.is_org_role(organization_id, ARRAY['admin', 'fleet-manager']));

-- ---------------------------------------------------------------------------
-- 3) drivers — admin/FM all org rows; driver only assigned user_id = auth.uid()
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS drivers_select_org_member ON public.drivers;

DROP POLICY IF EXISTS drivers_select_admin_fm ON public.drivers;
CREATE POLICY drivers_select_admin_fm
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (public.is_org_role(organization_id, ARRAY['admin', 'fleet-manager']));

DROP POLICY IF EXISTS drivers_select_assigned ON public.drivers;
CREATE POLICY drivers_select_assigned
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (
    user_id IS NOT NULL
    AND user_id = auth.uid()
    AND public.is_org_member(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4) driver_pii — admin all org; assigned driver own; fleet-manager none
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS driver_pii_select_admin ON public.driver_pii;
CREATE POLICY driver_pii_select_admin
  ON public.driver_pii
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = driver_id
        AND public.is_org_role(d.organization_id, ARRAY['admin'])
    )
  );

DROP POLICY IF EXISTS driver_pii_select_self ON public.driver_pii;
CREATE POLICY driver_pii_select_self
  ON public.driver_pii
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = driver_id
        AND d.user_id IS NOT NULL
        AND d.user_id = auth.uid()
        AND public.is_org_member(d.organization_id)
    )
  );

-- No fleet-manager policy on driver_pii.

-- ---------------------------------------------------------------------------
-- 5) vehicles — admin/FM all org; driver only assigned_driver_id → own driver
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS vehicles_select_org_member ON public.vehicles;

DROP POLICY IF EXISTS vehicles_select_admin_fm ON public.vehicles;
CREATE POLICY vehicles_select_admin_fm
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (public.is_org_role(organization_id, ARRAY['admin', 'fleet-manager']));

DROP POLICY IF EXISTS vehicles_select_assigned_driver ON public.vehicles;
CREATE POLICY vehicles_select_assigned_driver
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = assigned_driver_id
        AND d.user_id IS NOT NULL
        AND d.user_id = auth.uid()
        AND public.is_org_member(organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 6) Assertions — inventory + helper security catalog + expected policies
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  driver_count integer;
  driver_pii_count integer;
  vehicle_count integer;
  drivers_with_user_id integer;
  vehicles_with_assignment integer;
  founding_admin_count integer;
  personal_code_col integer;
  license_number_col integer;
  is_org_role_definer boolean;
  is_org_role_search_path text;
  anon_execute_count integer;
  public_execute_count integer;
  write_policy_count integer;
  anon_policy_count integer;
  using_true_count integer;
  old_member_policy_count integer;
  expected_policy_count integer;
  is_org_role_overload_count integer;
BEGIN
  SELECT count(*) INTO driver_count FROM public.drivers;
  SELECT count(*) INTO driver_pii_count FROM public.driver_pii;
  SELECT count(*) INTO vehicle_count FROM public.vehicles;

  IF driver_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected 2 drivers, found %',
      driver_count;
  END IF;

  IF driver_pii_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected 2 driver_pii rows, found %',
      driver_pii_count;
  END IF;

  IF vehicle_count <> 3 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected 3 vehicles, found %',
      vehicle_count;
  END IF;

  SELECT count(*) INTO drivers_with_user_id
  FROM public.drivers
  WHERE user_id IS NOT NULL;

  SELECT count(*) INTO vehicles_with_assignment
  FROM public.vehicles
  WHERE assigned_driver_id IS NOT NULL;

  IF drivers_with_user_id <> 0 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected 0 drivers.user_id assignments, found %',
      drivers_with_user_id;
  END IF;

  IF vehicles_with_assignment <> 0 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected 0 vehicles.assigned_driver_id assignments, found %',
      vehicles_with_assignment;
  END IF;

  SELECT count(*) INTO founding_admin_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE o.name = 'SovereignShield Fleet'
    AND om.user_id = 'ca5316b3-8872-45f4-9617-06d758f19f49'::uuid
    AND om.role = 'admin';

  IF founding_admin_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: founding admin membership missing (found %)',
      founding_admin_count;
  END IF;

  -- Expand window: PII columns must still exist on drivers.
  SELECT count(*) INTO personal_code_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'drivers'
    AND column_name = 'personal_code';

  SELECT count(*) INTO license_number_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'drivers'
    AND column_name = 'license_number';

  IF personal_code_col <> 1 OR license_number_col <> 1 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: drivers PII columns must remain during expand window';
  END IF;

  -- Resolve by regprocedure — Supabase/Postgres identity args include parameter
  -- names (e.g. 'p_organization_id uuid'), so matching 'uuid, text[]' alone fails
  -- and leaves prosecdef NULL, falsely failing the SECURITY DEFINER assertion.
  IF to_regprocedure('public.is_org_role(uuid, text[])') IS NULL THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: is_org_role(uuid, text[]) missing';
  END IF;

  SELECT count(*) INTO is_org_role_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'is_org_role';

  IF is_org_role_overload_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected exactly 1 is_org_role overload, found %',
      is_org_role_overload_count;
  END IF;

  SELECT p.prosecdef
  INTO is_org_role_definer
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.is_org_role(uuid, text[])');

  IF is_org_role_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Migration 2 assertion failed: is_org_role must be SECURITY DEFINER';
  END IF;

  -- Verify search_path configuration on the function via proconfig.
  SELECT coalesce(
    (
      SELECT string_agg(cfg, ',')
      FROM pg_proc p
      CROSS JOIN LATERAL unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
      WHERE p.oid = to_regprocedure('public.is_org_role(uuid, text[])')
        AND cfg ILIKE 'search_path=%'
    ),
    ''
  )
  INTO is_org_role_search_path;

  IF is_org_role_search_path NOT ILIKE '%public%'
     OR is_org_role_search_path NOT ILIKE '%pg_temp%' THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: is_org_role search_path not locked to public, pg_temp (got %)',
      is_org_role_search_path;
  END IF;

  SELECT count(*) INTO anon_execute_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name = 'is_org_role'
    AND grantee = 'anon'
    AND privilege_type = 'EXECUTE';

  IF anon_execute_count <> 0 THEN
    RAISE EXCEPTION 'Migration 2 assertion failed: anon must not EXECUTE is_org_role';
  END IF;

  SELECT count(*) INTO public_execute_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name = 'is_org_role'
    AND grantee = 'PUBLIC'
    AND privilege_type = 'EXECUTE';

  IF public_execute_count <> 0 THEN
    RAISE EXCEPTION 'Migration 2 assertion failed: PUBLIC must not EXECUTE is_org_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name = 'is_org_role'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 2 assertion failed: authenticated must EXECUTE is_org_role';
  END IF;

  -- is_org_member still present (unchanged contract).
  IF to_regprocedure('public.is_org_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Migration 2 assertion failed: is_org_member(uuid) missing';
  END IF;

  SELECT count(*) INTO old_member_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'organization_members_select_same_org',
      'drivers_select_org_member',
      'vehicles_select_org_member'
    );

  IF old_member_policy_count <> 0 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: old org-member SELECT policies still present (% )',
      old_member_policy_count;
  END IF;

  SELECT count(*) INTO expected_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'organization_members' AND policyname IN (
        'organization_members_select_self',
        'organization_members_select_staff'
      ))
      OR (tablename = 'drivers' AND policyname IN (
        'drivers_select_admin_fm',
        'drivers_select_assigned'
      ))
      OR (tablename = 'driver_pii' AND policyname IN (
        'driver_pii_select_admin',
        'driver_pii_select_self'
      ))
      OR (tablename = 'vehicles' AND policyname IN (
        'vehicles_select_admin_fm',
        'vehicles_select_assigned_driver'
      ))
      OR (tablename = 'organizations' AND policyname = 'organizations_select_member')
    );

  IF expected_policy_count <> 9 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: expected 9 role-aware/org policies, found %',
      expected_policy_count;
  END IF;

  SELECT count(*) INTO write_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'drivers',
      'driver_pii',
      'vehicles'
    )
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  IF write_policy_count <> 0 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: write policies must remain absent (found %)',
      write_policy_count;
  END IF;

  SELECT count(*) INTO anon_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'drivers',
      'driver_pii',
      'vehicles'
    )
    AND 'anon' = ANY (roles);

  IF anon_policy_count <> 0 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: anon policies must remain absent (found %)',
      anon_policy_count;
  END IF;

  SELECT count(*) INTO using_true_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'drivers',
      'driver_pii',
      'vehicles'
    )
    AND (qual = 'true' OR with_check = 'true');

  IF using_true_count <> 0 THEN
    RAISE EXCEPTION
      'Migration 2 assertion failed: USING(true)/WITH CHECK(true) forbidden (found %)',
      using_true_count;
  END IF;

  -- FORCE RLS still on driver_pii / drivers / vehicles.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'driver_pii'
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Migration 2 assertion failed: driver_pii must remain RLS enabled + forced';
  END IF;
END $$;

-- No INSERT/UPDATE/DELETE policies.
-- No anon policies.
-- No USING (true).
-- drivers.personal_code / license_number retained for expand window.
-- drivers.user_id / vehicles.assigned_driver_id remain NULL (unassigned).
