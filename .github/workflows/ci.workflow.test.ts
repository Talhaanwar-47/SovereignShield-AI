import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflowPath = join(dirname(fileURLToPath(import.meta.url)), 'ci.yml')
const workflow = readFileSync(workflowPath, 'utf8')

describe('GitHub Actions CI workflow', () => {
  it('runs the repository quality commands on main without deploys or server secrets', () => {
    expect(workflow).toContain('on:')
    expect(workflow).toMatch(/push:[\s\S]*branches:\s*\[main\]/)
    expect(workflow).toMatch(/pull_request:[\s\S]*branches:\s*\[main\]/)
    expect(workflow).toContain("node-version: '20'")
    expect(workflow).toContain('cache: npm')
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm test')
    expect(workflow).toContain('npm run lint')
    expect(workflow).toContain('npm run build')

    expect(workflow).toContain('permissions:')
    expect(workflow).toContain('contents: read')

    expect(workflow).toContain('VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}')
    expect(workflow).toContain('VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}')
    expect(workflow).toContain('test -n "$VITE_SUPABASE_URL"')
    expect(workflow).toContain('test -n "$VITE_SUPABASE_ANON_KEY"')
    expect(workflow).not.toMatch(/GEMINI_API_KEY/)
    expect(workflow).not.toMatch(/SERVICE_ROLE|service_role/)
    expect(workflow).not.toMatch(/cp\s+\.env|\.env\.example|echo\s+.*>\s*\.env/)
    expect(workflow).not.toMatch(/supabase db push/)
    expect(workflow).not.toMatch(/supabase functions deploy/)
  })
})
