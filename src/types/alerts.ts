export type AlertSeverity = 'critical' | 'high' | 'normal'

export type AlertCategory = 'vehicle' | 'compliance'

export type AlertState = 'open' | 'acknowledged' | 'resolved'

export type OperationalAlert = {
  /** Stable deterministic id derived from category, subject, and title. */
  id: string
  severity: AlertSeverity
  category: AlertCategory
  subjectId: string
  subjectName: string
  title: string
  description: string
  /** Origin of the alert fact — never a fake incident system. */
  source: string
  simulated: boolean
  recommendedAction: string
  state: AlertState
}

export type AlertSummary = {
  total: number
  critical: number
  high: number
  open: number
  acknowledged: number
  resolved: number
}

export type AlertFilter =
  | 'all'
  | 'critical'
  | 'high'
  | 'vehicle'
  | 'compliance'
  | 'open'
  | 'acknowledged'
  | 'resolved'
