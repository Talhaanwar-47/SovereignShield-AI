-- STEP 26E — Isolated demo organization + secure demo membership provisioning
--
-- Creates SovereignShield Demo tenant with safe fixture data and a SECURITY DEFINER
-- RPC that provisions demo organization_members rows for authenticated public visitors.
--
-- CRITICAL:
-- - Production SovereignShield Fleet org and memberships are unchanged.
-- - No broad INSERT/UPDATE policies on organization_members for clients.
-- - provision_demo_membership() rejects production org members and arbitrary roles.
-- - Demo driver PII is synthetic — never copied from production driver_pii.
-- - RLS remains authoritative; demo isolation is tenant-scoped via organization_id.

-- ---------------------------------------------------------------------------
-- 1) Demo organization (fixed UUID for client/server reference)
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (id, name)
VALUES (
  'd0000000-0000-4000-8000-000000000001'::uuid,
  'SovereignShield Demo'
);

-- ---------------------------------------------------------------------------
-- 2) Demo drivers (synthetic names — not production fixtures)
-- ---------------------------------------------------------------------------

INSERT INTO public.drivers (id, name, expiry_date, status, organization_id)
VALUES
  (
    'd0000000-0000-4000-8000-000000000010'::uuid,
    'Demo Driver Alex',
    '12 / 11 / 2026',
    'DEMO RECORD',
    'd0000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'd0000000-0000-4000-8000-000000000011'::uuid,
    'Demo Driver Blake',
    '03 / 05 / 2025',
    'DEMO RECORD',
    'd0000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'd0000000-0000-4000-8000-000000000012'::uuid,
    'Demo Driver Casey',
    '08 / 20 / 2027',
    'DEMO RECORD',
    'd0000000-0000-4000-8000-000000000001'::uuid
  );

INSERT INTO public.driver_pii (driver_id, personal_code, license_number)
VALUES
  (
    'd0000000-0000-4000-8000-000000000010'::uuid,
    '50001010001',
    'EE-DEMO-0001'
  ),
  (
    'd0000000-0000-4000-8000-000000000011'::uuid,
    '50002020002',
    'EE-DEMO-0002'
  ),
  (
    'd0000000-0000-4000-8000-000000000012'::uuid,
    '50003030003',
    'EE-DEMO-0003'
  );

-- ---------------------------------------------------------------------------
-- 3) Demo vehicles (EE-DEMO-* asset IDs — distinct from production EE-FLEET-*)
-- ---------------------------------------------------------------------------

-- driver_name is NOT NULL on public.vehicles (legacy denormalized text).
-- Assignment authority remains assigned_driver_id. Unassigned uses the
-- existing mapper convention: 'Unassigned' (UNASSIGNED_DRIVER_LABEL).
INSERT INTO public.vehicles (
  id,
  asset_id,
  driver_name,
  speed,
  battery,
  compliance_tier,
  organization_id,
  assigned_driver_id
)
VALUES
  (
    'd0000000-0000-4000-8000-000000000020'::uuid,
    'EE-DEMO-991',
    'Demo Driver Alex',
    '84 km/h',
    '72% Electric EV',
    'OPTIMAL CLEARANCE',
    'd0000000-0000-4000-8000-000000000001'::uuid,
    'd0000000-0000-4000-8000-000000000010'::uuid
  ),
  (
    'd0000000-0000-4000-8000-000000000021'::uuid,
    'EE-DEMO-402',
    'Demo Driver Jamie',
    '0 km/h (Stationary)',
    '91% Electric EV',
    'DOCK CHARGING',
    'd0000000-0000-4000-8000-000000000001'::uuid,
    'd0000000-0000-4000-8000-000000000011'::uuid
  ),
  (
    'd0000000-0000-4000-8000-000000000022'::uuid,
    'EE-DEMO-118',
    'Unassigned',
    '112 km/h (High)',
    '44% Diesel Engine',
    'CRITICAL WARNING',
    'd0000000-0000-4000-8000-000000000001'::uuid,
    NULL
  );

-- ---------------------------------------------------------------------------
-- 4) Secure demo membership provisioning (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provision_demo_membership(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_demo_org_id uuid := 'd0000000-0000-4000-8000-000000000001'::uuid;
  v_prod_org_id uuid;
  v_prod_member boolean;
  v_driver_id uuid;
  v_primary_driver_id uuid := 'd0000000-0000-4000-8000-000000000010'::uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('admin', 'fleet-manager', 'driver') THEN
    RAISE EXCEPTION 'Invalid demo role: must be admin, fleet-manager, or driver'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_prod_org_id
  FROM public.organizations
  WHERE name = 'SovereignShield Fleet';

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = v_demo_org_id
  ) THEN
    RAISE EXCEPTION 'Demo organization unavailable'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_prod_org_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organization_members
      WHERE user_id = v_user_id
        AND organization_id = v_prod_org_id
    ) INTO v_prod_member;

    IF v_prod_member THEN
      RAISE EXCEPTION 'Production organization members cannot use demo provisioning'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_demo_org_id, v_user_id, p_role)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.drivers
  SET user_id = NULL
  WHERE organization_id = v_demo_org_id
    AND user_id = v_user_id;

  IF p_role = 'driver' THEN
    SELECT id INTO v_driver_id
    FROM public.drivers
    WHERE organization_id = v_demo_org_id
      AND id = v_primary_driver_id;

    IF v_driver_id IS NULL THEN
      RAISE EXCEPTION 'Demo driver fixture unavailable'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.drivers
    SET user_id = v_user_id
    WHERE id = v_driver_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'role', p_role,
    'organization_id', v_demo_org_id::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_demo_membership(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provision_demo_membership(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_demo_membership(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  demo_org_count integer;
  demo_driver_count integer;
  demo_vehicle_count integer;
  demo_pii_count integer;
  demo_null_driver_name integer;
  demo_991_ok integer;
  demo_402_ok integer;
  demo_118_ok integer;
  fn_security text;
BEGIN
  SELECT count(*) INTO demo_org_count
  FROM public.organizations
  WHERE name = 'SovereignShield Demo';

  IF demo_org_count <> 1 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: expected 1 demo organization, found %',
      demo_org_count;
  END IF;

  SELECT count(*) INTO demo_driver_count
  FROM public.drivers
  WHERE organization_id = 'd0000000-0000-4000-8000-000000000001'::uuid;

  IF demo_driver_count <> 3 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: expected 3 demo drivers, found %',
      demo_driver_count;
  END IF;

  SELECT count(*) INTO demo_vehicle_count
  FROM public.vehicles
  WHERE organization_id = 'd0000000-0000-4000-8000-000000000001'::uuid;

  IF demo_vehicle_count <> 3 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: expected 3 demo vehicles, found %',
      demo_vehicle_count;
  END IF;

  SELECT count(*) INTO demo_null_driver_name
  FROM public.vehicles
  WHERE organization_id = 'd0000000-0000-4000-8000-000000000001'::uuid
    AND driver_name IS NULL;

  IF demo_null_driver_name <> 0 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: demo vehicles.driver_name must never be null, found %',
      demo_null_driver_name;
  END IF;

  SELECT count(*) INTO demo_991_ok
  FROM public.vehicles
  WHERE asset_id = 'EE-DEMO-991'
    AND driver_name = 'Demo Driver Alex'
    AND assigned_driver_id = 'd0000000-0000-4000-8000-000000000010'::uuid;

  IF demo_991_ok <> 1 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: EE-DEMO-991 must be assigned to Demo Driver Alex';
  END IF;

  SELECT count(*) INTO demo_402_ok
  FROM public.vehicles
  WHERE asset_id = 'EE-DEMO-402'
    AND driver_name = 'Demo Driver Jamie'
    AND assigned_driver_id = 'd0000000-0000-4000-8000-000000000011'::uuid;

  IF demo_402_ok <> 1 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: EE-DEMO-402 must keep assigned_driver_id and driver_name Demo Driver Jamie';
  END IF;

  SELECT count(*) INTO demo_118_ok
  FROM public.vehicles
  WHERE asset_id = 'EE-DEMO-118'
    AND driver_name = 'Unassigned'
    AND assigned_driver_id IS NULL;

  IF demo_118_ok <> 1 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: EE-DEMO-118 must be unassigned with driver_name Unassigned';
  END IF;

  SELECT count(*) INTO demo_pii_count
  FROM public.driver_pii dp
  JOIN public.drivers d ON d.id = dp.driver_id
  WHERE d.organization_id = 'd0000000-0000-4000-8000-000000000001'::uuid;

  IF demo_pii_count <> 3 THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: expected 3 demo driver_pii rows, found %',
      demo_pii_count;
  END IF;

  SELECT p.prosecdef::text INTO fn_security
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'provision_demo_membership';

  IF fn_security IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      'STEP 26E assertion failed: provision_demo_membership must be SECURITY DEFINER';
  END IF;
END $$;
