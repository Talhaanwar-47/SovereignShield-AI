/**
 * Remote `public.drivers` non-PII row shape (STEP 18E-6).
 * PII (`personal_code`, `license_number`) lives in `public.driver_pii`.
 * Optional legacy aliases retained only for demo/test fixtures.
 */
export interface DriverRow {
  id?: string
  name?: string
  expiry_date?: string
  /** Remote registry label — must NOT become DriverData.status */
  status?: string | null
  /** Assignment link for driver self-scope (may be null until ops assign). */
  user_id?: string | null
  /** @deprecated Legacy alias; remote column is `name` */
  full_name?: string
  fullName?: string
  expiryDate?: string
  document_type?: string
  documentType?: string
}

/**
 * Remote `public.driver_pii` row (1:1 with drivers.id).
 * Source of truth for personal_code / license_number after Migration 1.
 */
export interface DriverPiiRow {
  driver_id?: string
  personal_code?: string | null
  license_number?: string | null
}

export interface OcrResult {
  fullName: string
  documentType: string
  personalCode: string
  licenseNumber: string
  expiryDate: string
}

export type DriverRecordStatus = 'REGISTRY RECORD' | 'DEMO RECORD'

/**
 * UI registry record. `personalCode` / `licenseNumber` originate from
 * `driver_pii` when authorized; otherwise `"—"` (OCR treats as UNAVAILABLE).
 */
export interface DriverData extends OcrResult {
  status: DriverRecordStatus
  /** `public.drivers.id` when loaded from registry (for selection). */
  id?: string
}

export type OcrPipelinePhase = 'idle' | 'scanning' | 'complete'
