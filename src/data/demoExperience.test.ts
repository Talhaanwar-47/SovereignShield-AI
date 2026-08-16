import { describe, expect, it } from 'vitest'
import {
  COPILOT_DISCLOSURE,
  COPILOT_SUGGESTED_PROMPTS,
  DEMO_GUIDE_STEPS,
  DEMO_MODE_LABEL,
  EMPTY_STATES,
  LOADING_LABELS,
  NAV_TAB_LABELS,
  PRODUCT_DESCRIPTION,
  PRODUCT_TITLE,
  ROLE_OVERVIEWS,
  SIMULATED_TELEMETRY_LABEL,
} from './demoExperience'
import demoBannerSource from '../components/DemoModeBanner.tsx?raw'
import dashboardSource from '../DashboardLayout.tsx?raw'
import { copilotFailureUserMessage, COPILOT_TRANSIENT_BUSY_MESSAGE } from '../services/geminiCopilotHelpers'

describe('demoExperience', () => {
  it('defines recruiter-facing product copy without production claims', () => {
    expect(PRODUCT_TITLE).toBe('SovereignShield AI')
    expect(PRODUCT_DESCRIPTION).toContain('role-based access')
    expect(PRODUCT_DESCRIPTION.toLowerCase()).not.toContain('live gps')
    expect(PRODUCT_DESCRIPTION.toLowerCase()).not.toContain('production deployment')
  })

  it('uses professional demo mode and simulated telemetry labels', () => {
    expect(DEMO_MODE_LABEL).toBe('DEMO MODE')
    expect(SIMULATED_TELEMETRY_LABEL).toBe('SIMULATED TELEMETRY')
    expect(demoBannerSource).toContain('DEMO_MODE_LABEL')
    expect(demoBannerSource).toContain('SIMULATED_TELEMETRY_LABEL')
  })

  it('documents informational role overviews without bypass language', () => {
    expect(ROLE_OVERVIEWS).toHaveLength(3)
    expect(ROLE_OVERVIEWS.map((role) => role.title)).toEqual([
      'Admin',
      'Fleet Manager',
      'Driver',
    ])
    expect(JSON.stringify(ROLE_OVERVIEWS).toLowerCase()).not.toContain('bypass')
    expect(JSON.stringify(ROLE_OVERVIEWS).toLowerCase()).not.toContain('switch role')
  })

  it('provides recruiter copilot suggestions without restricting input', () => {
    expect(COPILOT_SUGGESTED_PROMPTS).toContain('Which vehicle is assigned to Jürgen?')
    expect(COPILOT_SUGGESTED_PROMPTS).toContain('Explain the current fleet health.')
    expect(dashboardSource).toContain('COPILOT_SUGGESTED_PROMPTS')
    expect(dashboardSource).toContain('type="text"')
  })

  it('includes a manual demo guide walkthrough', () => {
    expect(DEMO_GUIDE_STEPS).toHaveLength(7)
    expect(DEMO_GUIDE_STEPS[1]?.optionalPrompt).toBe('Which vehicle is assigned to Jürgen?')
    expect(dashboardSource).toContain('DemoGuidePanel')
  })

  it('defines professional empty and loading states', () => {
    expect(EMPTY_STATES.noAlerts).toBe('No active operational alerts.')
    expect(EMPTY_STATES.noHistoricalAudit).toContain('No historical audit data is available')
    expect(EMPTY_STATES.noDriverRisk).toContain('not available')
    expect(LOADING_LABELS.fleet).toBe('Loading fleet intelligence…')
    expect(LOADING_LABELS.compliance).toBe('Loading compliance data…')
  })

  it('uses consistent navigation labels', () => {
    expect(NAV_TAB_LABELS.copilot).toBe('AI Fleet Copilot')
    expect(NAV_TAB_LABELS.auditor).toBe('Audit & Security Center')
    expect(NAV_TAB_LABELS.analytics).toBe('Executive Analytics')
  })

  it('keeps copilot disclosure grounded and security-safe', () => {
    expect(COPILOT_DISCLOSURE).toContain('authorized application context')
    expect(COPILOT_DISCLOSURE).toContain('not live GPS')
    expect(copilotFailureUserMessage('upstream_gemini')).toBe(COPILOT_TRANSIENT_BUSY_MESSAGE)
    expect(copilotFailureUserMessage('upstream_gemini')).not.toMatch(
      /upstream|gemini|edge function|http 429|api key|jwt|stack/i,
    )
  })
})
