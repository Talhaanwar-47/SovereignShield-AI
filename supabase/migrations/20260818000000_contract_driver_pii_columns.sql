-- STEP 18E-7 — Migration 3 ONLY: CONTRACT (Approach C)
--
-- Drops duplicated PII columns from public.drivers after the expand window.
-- Canonical PII remains in public.driver_pii (Migration 1 + 2).
--
-- CRITICAL:
-- - Application must already select PII only from driver_pii (STEP 18E-6).
--   Source-scan assertion is enforced by companion vitest (preflight #7).
-- - Does NOT delete/truncate rows.
-- - Does NOT recreate drivers / vehicles / driver_pii.
-- - Does NOT change driver_pii data.
-- - Does NOT assign drivers.user_id or vehicles.assigned_driver_id.
-- - Does NOT modify role-aware RLS policies, Auth, Gemini, Login, or OCR.
-- - No INSERT/UPDATE/DELETE policies. No anon policies. No USING (true).

-- ---------------------------------------------------------------------------
-- 1) Pre-drop assertions (inventory + PII coverage)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  driver_pii_reg regclass;
  driver_count integer;
  driver_pii_count integer;
  vehicle_count integer;
  unmatched_drivers integer;
  orphan_pii integer;
  personal_code_col integer;
  license_number_col integer;
  founding_admin_count integer;
BEGIN
  SELECT to_regclass('public.driver_pii') INTO driver_pii_reg;
  IF driver_pii_reg IS NULL THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: public.driver_pii must exist before contract';
  END IF;

  SELECT count(*) INTO driver_count FROM public.drivers;
  SELECT count(*) INTO driver_pii_count FROM public.driver_pii;
  SELECT count(*) INTO vehicle_count FROM public.vehicles;

  IF driver_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected 2 drivers before drop, found %',
      driver_count;
  END IF;

  IF driver_pii_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected 2 driver_pii rows before drop, found %',
      driver_pii_count;
  END IF;

  IF vehicle_count <> 3 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected 3 vehicles before drop, found %',
      vehicle_count;
  END IF;

  -- Every drivers.id has exactly one driver_pii row (PK on driver_id ⇒ ≤1).
  SELECT count(*) INTO unmatched_drivers
  FROM public.drivers d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.driver_pii p WHERE p.driver_id = d.id
  );

  IF unmatched_drivers <> 0 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: % drivers missing driver_pii rows',
      unmatched_drivers;
  END IF;

  SELECT count(*) INTO orphan_pii
  FROM public.driver_pii p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = p.driver_id
  );

  IF orphan_pii <> 0 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: % orphan driver_pii rows without drivers',
      orphan_pii;
  END IF;

  IF driver_count <> driver_pii_count THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: drivers (%) and driver_pii (%) counts must match 1:1',
      driver_count,
      driver_pii_count;
  END IF;

  -- Columns must still exist so DROP is intentional (expand → contract).
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
      'Migration 3 assertion failed: drivers.personal_code / license_number must exist before drop';
  END IF;

  -- Ownership continuity (founding admin membership unchanged).
  SELECT count(*) INTO founding_admin_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE o.name = 'SovereignShield Fleet'
    AND om.user_id = 'ca5316b3-8872-45f4-9617-06d758f19f49'::uuid
    AND om.role = 'admin';

  IF founding_admin_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: founding admin membership missing before drop (found %)',
      founding_admin_count;
  END IF;

  -- Preflight #7 (app no longer selects drivers PII) is enforced outside SQL
  -- by contractDriverPii.migration.test.ts source scan before remote push.
END $$;

-- ---------------------------------------------------------------------------
-- 2) CONTRACT — drop duplicated PII columns from public.drivers
-- ---------------------------------------------------------------------------

ALTER TABLE public.drivers
  DROP COLUMN personal_code;

ALTER TABLE public.drivers
  DROP COLUMN license_number;

-- ---------------------------------------------------------------------------
-- 3) Post-drop assertions (columns gone; inventory + RLS invariants intact)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  driver_count integer;
  driver_pii_count integer;
  vehicle_count integer;
  personal_code_col integer;
  license_number_col integer;
  user_id_col integer;
  assigned_driver_id_col integer;
  founding_admin_count integer;
  write_policy_count integer;
  anon_policy_count integer;
  using_true_count integer;
  driver_pii_policy_count integer;
  expected_policy_count integer;
BEGIN
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

  IF personal_code_col <> 0 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: drivers.personal_code must not exist after drop';
  END IF;

  IF license_number_col <> 0 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: drivers.license_number must not exist after drop';
  END IF;

  SELECT count(*) INTO driver_count FROM public.drivers;
  SELECT count(*) INTO driver_pii_count FROM public.driver_pii;
  SELECT count(*) INTO vehicle_count FROM public.vehicles;

  IF driver_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected 2 drivers after drop, found %',
      driver_count;
  END IF;

  IF driver_pii_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected 2 driver_pii rows after drop, found %',
      driver_pii_count;
  END IF;

  IF vehicle_count <> 3 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected 3 vehicles after drop, found %',
      vehicle_count;
  END IF;

  SELECT count(*) INTO user_id_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'drivers'
    AND column_name = 'user_id';

  IF user_id_col <> 1 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: drivers.user_id must remain present';
  END IF;

  SELECT count(*) INTO assigned_driver_id_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vehicles'
    AND column_name = 'assigned_driver_id';

  IF assigned_driver_id_col <> 1 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: vehicles.assigned_driver_id must remain present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'driver_pii'
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: driver_pii must remain RLS enabled + forced';
  END IF;

  SELECT count(*) INTO driver_pii_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'driver_pii'
    AND policyname IN (
      'driver_pii_select_admin',
      'driver_pii_select_self'
    );

  IF driver_pii_policy_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: expected driver_pii role-aware SELECT policies, found %',
      driver_pii_policy_count;
  END IF;

  -- Full role-aware / org SELECT set from Migration 2 must remain untouched.
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
      'Migration 3 assertion failed: expected 9 role-aware/org policies intact, found %',
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
      'Migration 3 assertion failed: write policies must remain absent (found %)',
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
      'Migration 3 assertion failed: anon policies must remain absent (found %)',
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
      'Migration 3 assertion failed: USING(true)/WITH CHECK(true) forbidden (found %)',
      using_true_count;
  END IF;

  SELECT count(*) INTO founding_admin_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE o.name = 'SovereignShield Fleet'
    AND om.user_id = 'ca5316b3-8872-45f4-9617-06d758f19f49'::uuid
    AND om.role = 'admin';

  IF founding_admin_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 3 assertion failed: founding admin membership missing after drop (found %)',
      founding_admin_count;
  END IF;
END $$;

-- No INSERT/UPDATE/DELETE policies added.
-- No anon policies. No USING (true).
-- Role-aware RLS policies unmodified.
-- drivers.user_id / vehicles.assigned_driver_id remain (assignment still ops-owned).
-- Canonical PII: public.driver_pii only.
