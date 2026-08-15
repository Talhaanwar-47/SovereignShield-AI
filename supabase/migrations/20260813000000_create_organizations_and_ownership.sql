-- STEP 18A — Organizations + ownership backfill (deny-by-default)
--
-- Creates organizations / organization_members, adds organization_id to
-- drivers and vehicles, and backfills the known SovereignShield Fleet rows.
--
-- CRITICAL:
-- - No CREATE POLICY on organizations, organization_members, drivers, or vehicles.
-- - Existing drivers/vehicles RLS (enabled + forced, zero policies) is preserved.
-- - Anon remains denied. Live SELECT is NOT opened.
-- - All UUIDs below were discovered in STEP 18; none are invented.

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'fleet-manager', 'driver')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_members_user_id_idx
  ON public.organization_members (user_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members FORCE ROW LEVEL SECURITY;

-- Intentionally no CREATE POLICY on organizations / organization_members.

ALTER TABLE public.drivers
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.vehicles
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

CREATE INDEX drivers_organization_id_idx ON public.drivers (organization_id);
CREATE INDEX vehicles_organization_id_idx ON public.vehicles (organization_id);

INSERT INTO public.organizations (name)
VALUES ('SovereignShield Fleet');

-- Founding Auth user UUID discovered in STEP 18 (auth.users count = 1).
INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT id, 'ca5316b3-8872-45f4-9617-06d758f19f49'::uuid, 'admin'
FROM public.organizations
WHERE name = 'SovereignShield Fleet';

-- Driver UUIDs discovered in STEP 18.
UPDATE public.drivers
SET organization_id = (
  SELECT id FROM public.organizations WHERE name = 'SovereignShield Fleet'
)
WHERE id IN (
  'ba05b0eb-6542-45a0-b350-9bf5ae2d35c7'::uuid,
  'cf96b4cf-910b-4452-93ce-22085077977c'::uuid
);

-- Vehicle UUIDs discovered in STEP 18.
UPDATE public.vehicles
SET organization_id = (
  SELECT id FROM public.organizations WHERE name = 'SovereignShield Fleet'
)
WHERE id IN (
  'b6160f57-792b-4e27-8c5b-4693d141511a'::uuid,
  '5878cb48-9164-4c13-9b42-c161179065e0'::uuid,
  'b2e3d711-7183-42b4-b673-43bd857e9512'::uuid
);

DO $$
DECLARE
  org_count integer;
  member_count integer;
  unassigned_drivers integer;
  unassigned_vehicles integer;
  expected_drivers integer := 2;
  expected_vehicles integer := 3;
  assigned_drivers integer;
  assigned_vehicles integer;
BEGIN
  SELECT count(*) INTO org_count
  FROM public.organizations
  WHERE name = 'SovereignShield Fleet';

  IF org_count <> 1 THEN
    RAISE EXCEPTION
      'Ownership assertion failed: expected exactly 1 organization named SovereignShield Fleet, found %',
      org_count;
  END IF;

  SELECT count(*) INTO member_count
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE o.name = 'SovereignShield Fleet'
    AND om.user_id = 'ca5316b3-8872-45f4-9617-06d758f19f49'::uuid
    AND om.role = 'admin';

  IF member_count <> 1 THEN
    RAISE EXCEPTION
      'Ownership assertion failed: expected exactly 1 founding admin membership, found %',
      member_count;
  END IF;

  SELECT count(*) INTO assigned_drivers
  FROM public.drivers
  WHERE id IN (
    'ba05b0eb-6542-45a0-b350-9bf5ae2d35c7'::uuid,
    'cf96b4cf-910b-4452-93ce-22085077977c'::uuid
  )
    AND organization_id IS NOT NULL;

  SELECT count(*) INTO assigned_vehicles
  FROM public.vehicles
  WHERE id IN (
    'b6160f57-792b-4e27-8c5b-4693d141511a'::uuid,
    '5878cb48-9164-4c13-9b42-c161179065e0'::uuid,
    'b2e3d711-7183-42b4-b673-43bd857e9512'::uuid
  )
    AND organization_id IS NOT NULL;

  IF assigned_drivers <> expected_drivers THEN
    RAISE EXCEPTION
      'Ownership assertion failed: expected % assigned drivers, found %',
      expected_drivers, assigned_drivers;
  END IF;

  IF assigned_vehicles <> expected_vehicles THEN
    RAISE EXCEPTION
      'Ownership assertion failed: expected % assigned vehicles, found %',
      expected_vehicles, assigned_vehicles;
  END IF;

  SELECT count(*) INTO unassigned_drivers
  FROM public.drivers
  WHERE organization_id IS NULL;

  SELECT count(*) INTO unassigned_vehicles
  FROM public.vehicles
  WHERE organization_id IS NULL;

  IF unassigned_drivers > 0 OR unassigned_vehicles > 0 THEN
    RAISE EXCEPTION
      'Ownership backfill incomplete; refusing SET NOT NULL (unassigned drivers=%, vehicles=%)',
      unassigned_drivers, unassigned_vehicles;
  END IF;
END $$;

ALTER TABLE public.drivers ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN organization_id SET NOT NULL;

-- Preserve drivers/vehicles RLS enabled+forced with zero SELECT policies.
-- Do not add CREATE POLICY for drivers, vehicles, organizations, or organization_members.
