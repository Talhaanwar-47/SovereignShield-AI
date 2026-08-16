import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { UNASSIGNED_DRIVER_LABEL } from '../../src/data/mappers'

const migrationsDir = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(
  migrationsDir,
  '20260819000000_demo_organization_and_provisioning.sql',
)
const sql = readFileSync(migrationPath, 'utf8')

const sqlCode = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--')
    return idx === -1 ? line : line.slice(0, idx)
  })
  .join('\n')

describe('STEP 26E — demo organization migration', () => {
  it('creates isolated SovereignShield Demo tenant with fixture data', () => {
    expect(sql).toContain("'SovereignShield Demo'")
    expect(sql).toContain("'EE-DEMO-991'")
    expect(sql).toContain("'EE-DEMO-402'")
    expect(sql).toContain("'EE-DEMO-118'")
    expect(sql).toContain("'Demo Driver Alex'")
    expect(sql).toContain("'EE-DEMO-0001'")
    expect(sql).not.toContain("'EE-FLEET-991'")
    expect(sql).not.toContain('Jürgen Tamm')
    expect(sql).toContain("'SovereignShield Demo'")
  })

  it('defines SECURITY DEFINER provision_demo_membership with role allowlist', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.provision_demo_membership/)
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = public, pg_temp/)
    expect(sqlCode).toContain("p_role NOT IN ('admin', 'fleet-manager', 'driver')")
    expect(sqlCode).toContain('auth.uid()')
    expect(sqlCode).toContain('Production organization members cannot use demo provisioning')
    expect(sqlCode).toContain("'SovereignShield Fleet'")
  })

  it('grants execute to authenticated only — not anon', () => {
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.provision_demo_membership(text) FROM anon',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.provision_demo_membership(text) TO authenticated',
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.provision_demo_membership\(text\) TO anon/,
    )
  })

  it('does not add broad client write policies on organization_members', () => {
    expect(sqlCode).not.toMatch(/CREATE POLICY.*organization_members.*INSERT/i)
    expect(sqlCode).not.toMatch(/CREATE POLICY.*organization_members.*UPDATE/i)
    expect(sqlCode).not.toMatch(/USING \(true\)/)
  })

  it('satisfies vehicles.driver_name NOT NULL using existing unassigned convention', () => {
    expect(sqlCode).toMatch(/INSERT INTO public\.vehicles/)
    expect(sqlCode).toContain('driver_name')
    expect(sqlCode).toContain("'Demo Driver Alex'")
    expect(sqlCode).toContain("'Demo Driver Jamie'")
    expect(sqlCode).toContain(`'${UNASSIGNED_DRIVER_LABEL}'`)
    expect(UNASSIGNED_DRIVER_LABEL).toBe('Unassigned')

    const vehicleInsert = sqlCode.match(
      /INSERT INTO public\.vehicles\s*\(([\s\S]*?)\)\s*VALUES\s*([\s\S]*?);/,
    )
    expect(vehicleInsert).not.toBeNull()
    const columns = vehicleInsert![1]
    const values = vehicleInsert![2]
    expect(columns).toMatch(/driver_name/)
    expect(columns).toMatch(/assigned_driver_id/)
    expect(values).not.toMatch(/driver_name\s*=\s*NULL/i)
    expect(values).not.toMatch(/,\s*NULL\s*,\s*'84 km\/h'/)

    expect(sqlCode).toMatch(
      /'EE-DEMO-991'[\s\S]*'Demo Driver Alex'[\s\S]*'d0000000-0000-4000-8000-000000000010'/,
    )
    expect(sqlCode).toMatch(
      /'EE-DEMO-402'[\s\S]*'Demo Driver Jamie'[\s\S]*'d0000000-0000-4000-8000-000000000011'/,
    )
    expect(sqlCode).toMatch(
      /'EE-DEMO-118'[\s\S]*'Unassigned'[\s\S]*NULL/,
    )
    expect(sql).toContain('demo vehicles.driver_name must never be null')
    expect(sql).toContain('EE-DEMO-118 must be unassigned with driver_name Unassigned')
  })
})
