-- STEP 18E-4 — Migration 1 ONLY: EXPAND schema + data (Approach C)
--
-- Creates driver_pii, backfills PII from drivers, adds nullable assignment
-- columns for future role-aware scoping.
--
-- CRITICAL:
-- - No SELECT/INSERT/UPDATE/DELETE policies on driver_pii (deny-by-default).
-- - No changes to existing RLS policies on drivers/vehicles/organizations/
--   organization_members.
-- - No anon policies. No USING (true). No write policies.
-- - Does NOT assign drivers.user_id or vehicles.assigned_driver_id.
-- - Does NOT invent UUIDs or create auth users.
-- - Leaves drivers.personal_code / drivers.license_number in place.

CREATE TABLE public.driver_pii (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  personal_code text,
  license_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_pii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_pii FORCE ROW LEVEL SECURITY;

-- Intentionally no CREATE POLICY on driver_pii (deny-by-default).

INSERT INTO public.driver_pii (driver_id, personal_code, license_number)
SELECT d.id, d.personal_code, d.license_number
FROM public.drivers d
ON CONFLICT (driver_id) DO NOTHING;

ALTER TABLE public.drivers
  ADD COLUMN user_id uuid NULL REFERENCES auth.users(id);

CREATE UNIQUE INDEX drivers_organization_id_user_id_uidx
  ON public.drivers (organization_id, user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.vehicles
  ADD COLUMN assigned_driver_id uuid NULL REFERENCES public.drivers(id);

CREATE INDEX vehicles_assigned_driver_id_idx
  ON public.vehicles (assigned_driver_id)
  WHERE assigned_driver_id IS NOT NULL;

DO $$
DECLARE
  driver_count integer;
  driver_pii_count integer;
  vehicle_count integer;
  unmatched_drivers integer;
  drivers_with_user_id integer;
  vehicles_with_assignment integer;
BEGIN
  SELECT count(*) INTO driver_count FROM public.drivers;
  SELECT count(*) INTO driver_pii_count FROM public.driver_pii;
  SELECT count(*) INTO vehicle_count FROM public.vehicles;

  IF driver_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 1 assertion failed: expected 2 drivers, found %',
      driver_count;
  END IF;

  IF driver_pii_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 1 assertion failed: expected 2 driver_pii rows, found %',
      driver_pii_count;
  END IF;

  IF vehicle_count <> 3 THEN
    RAISE EXCEPTION
      'Migration 1 assertion failed: expected 3 vehicles, found %',
      vehicle_count;
  END IF;

  SELECT count(*) INTO unmatched_drivers
  FROM public.drivers d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.driver_pii p WHERE p.driver_id = d.id
  );

  IF unmatched_drivers <> 0 THEN
    RAISE EXCEPTION
      'Migration 1 assertion failed: % drivers missing driver_pii rows',
      unmatched_drivers;
  END IF;

  -- Expand-only: no assignments invented in this migration.
  SELECT count(*) INTO drivers_with_user_id
  FROM public.drivers
  WHERE user_id IS NOT NULL;

  SELECT count(*) INTO vehicles_with_assignment
  FROM public.vehicles
  WHERE assigned_driver_id IS NOT NULL;

  IF drivers_with_user_id <> 0 THEN
    RAISE EXCEPTION
      'Migration 1 assertion failed: expected 0 drivers.user_id assignments, found %',
      drivers_with_user_id;
  END IF;

  IF vehicles_with_assignment <> 0 THEN
    RAISE EXCEPTION
      'Migration 1 assertion failed: expected 0 vehicles.assigned_driver_id assignments, found %',
      vehicles_with_assignment;
  END IF;
END $$;

-- Preserve existing drivers.personal_code / drivers.license_number (no DROP).
-- Existing RLS policies unchanged.
-- No write policies. No anon policies. No USING (true).
