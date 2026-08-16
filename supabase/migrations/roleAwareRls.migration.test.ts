import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(
  migrationsDir,
  '20260817000000_role_aware_rls_policies.sql',
)
const sql = readFileSync(migrationPath, 'utf8')

/** Strip `--` line comments so negative assertions ignore documentation text. */
const sqlCode = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--')
    return idx === -1 ? line : line.slice(0, idx)
  })
  .join('\n')

const FOUNDING_ADMIN_ID = 'ca5316b3-8872-45f4-9617-06d758f19f49'

describe('Migration 2 — is_org_role helper security', () => {
  it('creates SECURITY DEFINER helper with locked search_path', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_org_role\s*\(/)
    expect(sql).toMatch(/LANGUAGE sql/)
    expect(sql).toMatch(/\bSTABLE\b/)
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = public, pg_temp/)
    expect(sql).toContain(
      "Migration 2 assertion failed: is_org_role must be SECURITY DEFINER",
    )
    expect(sql).toContain("to_regprocedure('public.is_org_role(uuid, text[])')")
    expect(sql).not.toContain(
      "pg_get_function_identity_arguments(p.oid) = 'uuid, text[]'",
    )
  })

  it('authorizes only via auth.uid() + organization_members.role', () => {
    expect(sqlCode).toContain('om.user_id = auth.uid()')
    expect(sqlCode).toContain('om.role = ANY (p_roles)')
    expect(sqlCode).not.toMatch(/is_org_role\([^)]*user_id/)
    expect(sqlCode).not.toContain('p_user_id')
    expect(sqlCode).not.toMatch(/SERVICE_ROLE|service_role/)
  })

  it('revokes PUBLIC/anon and grants authenticated only', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.is_org_role(uuid, text[]) FROM PUBLIC',
    )
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.is_org_role(uuid, text[]) FROM anon',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.is_org_role(uuid, text[]) TO authenticated',
    )
    expect(sql).toContain('Intentionally no EXECUTE grant to anon')
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_org_role\(uuid, text\[\]\) TO anon/,
    )
    expect(sql).toContain(
      "Migration 2 assertion failed: anon must not EXECUTE is_org_role",
    )
  })

  it('keeps is_org_member unchanged (no REPLACE of membership helper)', () => {
    expect(sql).toContain('is_org_member(uuid) intentionally left unchanged')
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.is_org_member/)
  })
})

describe('Migration 2 — organization_members policies', () => {
  it('replaces same-org SELECT with self + staff policies', () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS organization_members_select_same_org',
    )
    expect(sql).toContain('CREATE POLICY organization_members_select_self')
    expect(sql).toContain('USING (user_id = auth.uid())')
    expect(sql).toContain('CREATE POLICY organization_members_select_staff')
    expect(sql).toContain(
      "is_org_role(organization_id, ARRAY['admin', 'fleet-manager'])",
    )
  })

  it('isolates peer membership from drivers (no broad is_org_member on members)', () => {
    const membersBlock = sql.slice(
      sql.indexOf('-- 2) organization_members'),
      sql.indexOf('-- 3) drivers'),
    )
    expect(membersBlock).not.toContain('is_org_member(organization_id)')
    expect(membersBlock).toContain('organization_members_select_self')
    expect(membersBlock).toContain('organization_members_select_staff')
  })
})

describe('Migration 2 — drivers / driver_pii / vehicles matrix', () => {
  it('admin/fleet-manager see all org drivers; driver only assigned row', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS drivers_select_org_member')
    expect(sql).toContain('CREATE POLICY drivers_select_admin_fm')
    expect(sql).toContain(
      "is_org_role(organization_id, ARRAY['admin', 'fleet-manager'])",
    )
    expect(sql).toContain('CREATE POLICY drivers_select_assigned')
    expect(sql).toMatch(/user_id IS NOT NULL[\s\S]*user_id = auth\.uid\(\)/)
    expect(sql).toContain('is_org_member(organization_id)')
  })

  it('driver_pii: admin yes, self yes, fleet-manager none', () => {
    expect(sql).toContain('CREATE POLICY driver_pii_select_admin')
    expect(sql).toContain("is_org_role(d.organization_id, ARRAY['admin'])")
    expect(sql).toContain('CREATE POLICY driver_pii_select_self')
    expect(sql).toContain('No fleet-manager policy on driver_pii')
    expect(sql).not.toMatch(
      /driver_pii[\s\S]{0,400}ARRAY\['admin',\s*'fleet-manager'\]/,
    )
  })

  it('vehicles: admin/FM all org; driver only via assigned_driver_id → own user_id', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS vehicles_select_org_member')
    expect(sql).toContain('CREATE POLICY vehicles_select_admin_fm')
    expect(sql).toContain('CREATE POLICY vehicles_select_assigned_driver')
    expect(sql).toContain('d.id = assigned_driver_id')
    expect(sql).toContain('d.user_id = auth.uid()')
  })

  it('encodes unassigned driver = no rows (NULL user_id / assigned_driver_id)', () => {
    expect(sql).toContain('user_id IS NOT NULL')
    expect(sql).toContain('d.user_id IS NOT NULL')
    expect(sql).toContain('expected 0 drivers.user_id assignments')
    expect(sql).toContain('expected 0 vehicles.assigned_driver_id assignments')
  })
})

describe('Migration 2 — safety invariants', () => {
  it('does not drop drivers PII columns or invent assignments/UUIDs', () => {
    expect(sql).not.toMatch(/DROP COLUMN\s+personal_code/i)
    expect(sql).not.toMatch(/DROP COLUMN\s+license_number/i)
    expect(sql).toContain('drivers PII columns must remain during expand window')
    expect(sql).not.toMatch(/UPDATE\s+public\.drivers\s+SET\s+user_id/i)
    expect(sql).not.toMatch(
      /UPDATE\s+public\.vehicles\s+SET\s+assigned_driver_id/i,
    )
    expect(sql).toContain('Does NOT invent UUIDs')
  })

  it('forbids USING(true), anon policies, and write policies', () => {
    // Policy bodies only — ignore assertion string literals that mention the ban.
    const policyBodies = [...sqlCode.matchAll(/CREATE POLICY[\s\S]*?;/gi)].map(
      (match) => match[0],
    )
    expect(policyBodies.length).toBeGreaterThan(0)
    for (const body of policyBodies) {
      expect(body).not.toMatch(/USING\s*\(\s*true\s*\)/i)
      expect(body).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i)
      expect(body).toMatch(/FOR\s+SELECT/i)
      expect(body).toMatch(/TO\s+authenticated/i)
      expect(body).not.toMatch(/TO\s+anon/i)
    }
    expect(sql).toContain('No anon policies')
    expect(sql).toContain('write policies must remain absent')
    expect(sql).toContain('anon policies must remain absent')
    expect(sqlCode).not.toMatch(/CREATE POLICY[\s\S]*?FOR\s+INSERT/i)
    expect(sqlCode).not.toMatch(/CREATE POLICY[\s\S]*?FOR\s+UPDATE/i)
    expect(sqlCode).not.toMatch(/CREATE POLICY[\s\S]*?FOR\s+DELETE/i)
  })

  it('preserves founding admin inventory expectations', () => {
    expect(sql).toContain(FOUNDING_ADMIN_ID)
    expect(sql).toContain("om.role = 'admin'")
    expect(sql).toContain('expected 2 drivers')
    expect(sql).toContain('expected 2 driver_pii rows')
    expect(sql).toContain('expected 3 vehicles')
    expect(sql).toContain('founding admin membership missing')
  })

  it('keeps organizations_select_member on is_org_member for Gemini/profile org path', () => {
    expect(sql).toContain('organizations_select_member')
    expect(sql).toContain('organizations_select_member remains is_org_member')
  })

  it('documents cross-org isolation via organization_id-scoped helpers', () => {
    expect(sql).toMatch(/is_org_role\(organization_id/)
    expect(sql).toMatch(/is_org_role\(d\.organization_id/)
    expect(sql).toContain('is_org_member(organization_id)')
  })
})
