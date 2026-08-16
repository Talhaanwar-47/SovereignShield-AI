import { describe, expect, it } from 'vitest'
import { validateOcrFile } from './ocrValidation'

describe('validateOcrFile', () => {
  it('accepts supported image MIME types', () => {
    expect(validateOcrFile(new File(['x'], 'photo.jpeg', { type: 'image/jpeg' }))).toBeNull()
    expect(validateOcrFile(new File(['x'], 'photo.png', { type: 'image/png' }))).toBeNull()
    expect(validateOcrFile(new File(['x'], 'photo.webp', { type: 'image/webp' }))).toBeNull()
  })

  it('rejects unsupported MIME types before OCR would start', () => {
    const error = validateOcrFile(new File(['x'], 'document.pdf', { type: 'application/pdf' }))

    expect(error).toBe('Unsupported file type. Please upload a JPEG, PNG, or WebP image.')
  })

  it('rejects files over the 10 MB limit', () => {
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    })

    expect(validateOcrFile(oversized)).toBe('File size must be 10 MB or smaller.')
  })

  it('rejects empty files', () => {
    expect(validateOcrFile(new File([], 'empty.png', { type: 'image/png' }))).toBe(
      'Please select a file.',
    )
  })
})
