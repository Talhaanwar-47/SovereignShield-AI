const MAX_OCR_FILE_SIZE_BYTES = 10 * 1024 * 1024

const ALLOWED_OCR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function validateOcrFile(file: File): string | null {
  if (file.size === 0) {
    return 'Please select a file.'
  }

  if (file.size > MAX_OCR_FILE_SIZE_BYTES) {
    return 'File size must be 10 MB or smaller.'
  }

  if (!ALLOWED_OCR_MIME_TYPES.has(file.type)) {
    return 'Unsupported file type. Please upload a JPEG, PNG, or WebP image.'
  }

  return null
}
