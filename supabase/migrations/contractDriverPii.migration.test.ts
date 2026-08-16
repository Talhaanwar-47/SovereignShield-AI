import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DRIVER_SELECT_COLUMNS } from '../../src/services/fleetService'

const migrationsDir = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(
  migrationsDir,
  '20260818000000_contract_driver_pii_columns.sql',
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
const srcRoot = join(migrationsDir, '../../src')

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

describe('Migration 3 — CONTRACT driver PII columns', () => {
  it('is the single contract migration dropping drivers PII columns', () => {
    expect(sql).toContain('STEP 18E-7 — Migration 3 ONLY: CONTRACT')
    expect(sqlCode).toMatch(
      /ALTER\s+TABLE\s+public\.drivers\s+DROP\s+COLUMN\s+personal_code/i,
    )
    expect(sqlCode).toMatch(
      /ALTER\s+TABLE\s+public\.drivers\s+DROP\s+COLUMN\s+license_number/i,
    )
  })

  it('asserts driver_pii existence and 2/2/3 inventory before drop', () => {
    expect(sql).toContain("to_regclass('public.driver_pii')")
    expect(sql).toContain('public.driver_pii must exist before contract')
    expect(sql).toContain('expected 2 drivers before drop')
    expect(sql).toContain('expected 2 driver_pii rows before drop')
    expect(sql).toContain('expected 3 vehicles before drop')
    expect(sql).toContain('drivers missing driver_pii rows')
    expect(sql).toContain('orphan driver_pii rows without drivers')
    expect(sql).toContain('counts must match 1:1')
  })

  it('asserts PII columns exist before drop and are gone after', () => {
    expect(sql).toContain(
      'drivers.personal_code / license_number must exist before drop',
    )
    expect(sql).toContain(
      'drivers.personal_code must not exist after drop',
    )
    expect(sql).toContain(
      'drivers.license_number must not exist after drop',
    )
    expect(sql).toContain('expected 2 drivers after drop')
    expect(sql).toContain('expected 2 driver_pii rows after drop')
    expect(sql).toContain('expected 3 vehicles after drop')
  })

  it('preserves assignment columns, ownership, and driver_pii RLS matrix', () => {
    expect(sql).toContain('drivers.user_id must remain present')
    expect(sql).toContain('vehicles.assigned_driver_id must remain present')
    expect(sql).toContain('driver_pii must remain RLS enabled + forced')
    expect(sql).toContain('driver_pii_select_admin')
    expect(sql).toContain('driver_pii_select_self')
    expect(sql).toContain('expected driver_pii role-aware SELECT policies')
    expect(sql).toContain('expected 9 role-aware/org policies intact')
    expect(sql).toContain(FOUNDING_ADMIN_ID)
    expect(sql).toContain('founding admin membership missing before drop')
    expect(sql).toContain('founding admin membership missing after drop')
  })

  it('forbids writes, anon policies, USING(true), and RLS/policy edits', () => {
    expect(sql).toContain('write policies must remain absent')
    expect(sql).toContain('anon policies must remain absent')
    expect(sql).toContain('USING(true)/WITH CHECK(true) forbidden')
    expect(sqlCode).not.toMatch(/CREATE\s+POLICY/i)
    expect(sqlCode).not.toMatch(/DROP\s+POLICY/i)
    expect(sqlCode).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i)
    expect(sqlCode).not.toMatch(/DELETE\s+FROM/i)
    expect(sqlCode).not.toMatch(/TRUNCATE/i)
    expect(sqlCode).not.toMatch(/UPDATE\s+public\.drivers/i)
    expect(sqlCode).not.toMatch(/UPDATE\s+public\.driver_pii/i)
    expect(sqlCode).not.toMatch(/UPDATE\s+public\.vehicles/i)
    expect(sqlCode).not.toMatch(/INSERT\s+INTO/i)
  })
})

describe('Migration 3 preflight #7 — app no longer selects drivers PII', () => {
  it('DRIVER_SELECT_COLUMNS excludes personal_code and license_number', () => {
    expect(DRIVER_SELECT_COLUMNS).toBe('id,name,expiry_date,status,user_id')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('personal_code')
    expect(DRIVER_SELECT_COLUMNS).not.toContain('license_number')
  })

  it('no application source selects personal_code/license_number from drivers', () => {
    const files = collectSourceFiles(srcRoot)
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      // Ignore pure documentation / driver_pii field names outside drivers selects.
      const driversSelectBlocks = [
        ...source.matchAll(
          /\.from\(\s*['"]drivers['"]\s*\)\s*\.select\(\s*([^)]+)\)/g,
        ),
      ]

      for (const match of driversSelectBlocks) {
        const selectArg = match[1] ?? ''
        if (
          /personal_code/.test(selectArg) ||
          /license_number/.test(selectArg)
        ) {
          offenders.push(`${file}: ${match[0]}`)
        }
      }

      // Constant used for drivers select must stay non-PII.
      if (
        file.endsWith('fleetService.ts') &&
        /DRIVER_SELECT_COLUMNS\s*=\s*'[^']*(personal_code|license_number)/.test(
          source,
        )
      ) {
        offenders.push(`${file}: DRIVER_SELECT_COLUMNS includes PII`)
      }
    }

    expect(offenders).toEqual([])
  })
})
