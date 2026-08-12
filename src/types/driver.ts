export interface OcrResult {
  fullName: string
  documentType: string
  personalCode: string
  licenseNumber: string
  expiryDate: string
}

export interface DriverData extends OcrResult {
  status: string
}

export type OcrPipelinePhase = 'idle' | 'scanning' | 'complete'

export interface DriverRow {
  id?: string | number
  full_name?: string
  fullName?: string
  name?: string
  document_type?: string
  documentType?: string
  personal_code?: string
  personalCode?: string
  isikukood?: string
  license_number?: string
  licenseNumber?: string
  expiry_date?: string
  expiryDate?: string
  match_score?: string
  matchScore?: string
}
