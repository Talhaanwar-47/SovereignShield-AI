import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorkerMock } = vi.hoisted(() => ({
  createWorkerMock: vi.fn(),
}))

vi.mock('tesseract.js', () => ({
  default: {
    createWorker: createWorkerMock,
  },
}))

import {
  formatOcrConfidencePercent,
  isLowOcrConfidence,
  normalizeOcrConfidence,
  recognizeDocumentText,
} from './ocrService'

function createMockWorker(recognizeImpl: () => Promise<{ data: { text: string; confidence: unknown } }>) {
  const terminate = vi.fn().mockResolvedValue(undefined)
  const recognize = vi.fn().mockImplementation(recognizeImpl)

  createWorkerMock.mockResolvedValue({
    recognize,
    terminate,
  })

  return { recognize, terminate }
}

describe('normalizeOcrConfidence', () => {
  it('returns finite numbers unchanged', () => {
    expect(normalizeOcrConfidence(87.4)).toBe(87.4)
  })

  it('returns null for non-finite or missing values', () => {
    expect(normalizeOcrConfidence(null)).toBeNull()
    expect(normalizeOcrConfidence(undefined)).toBeNull()
    expect(normalizeOcrConfidence(Number.NaN)).toBeNull()
  })
})

describe('isLowOcrConfidence', () => {
  it('flags confidence below the threshold', () => {
    expect(isLowOcrConfidence(69.9)).toBe(true)
  })

  it('does not flag confidence at or above the threshold', () => {
    expect(isLowOcrConfidence(70)).toBe(false)
    expect(isLowOcrConfidence(90)).toBe(false)
  })

  it('does not flag unavailable confidence', () => {
    expect(isLowOcrConfidence(null)).toBe(false)
  })
})

describe('formatOcrConfidencePercent', () => {
  it('rounds confidence for display', () => {
    expect(formatOcrConfidencePercent(87.4)).toBe('87%')
    expect(formatOcrConfidencePercent(69.6)).toBe('70%')
  })
})

describe('recognizeDocumentText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns extracted text and page-level confidence', async () => {
    createMockWorker(async () => ({
      data: { text: 'Personal code 39001010000', confidence: 87.4 },
    }))

    const file = new File(['image'], 'license.png', { type: 'image/png' })
    const result = await recognizeDocumentText(file)

    expect(result).toEqual({
      text: 'Personal code 39001010000',
      confidence: 87.4,
    })
    expect(createWorkerMock).toHaveBeenCalledWith('est+eng', 1, expect.any(Object))
  })

  it('returns null confidence when Tesseract does not provide a finite value', async () => {
    createMockWorker(async () => ({
      data: { text: 'Personal code 39001010000', confidence: null },
    }))

    const file = new File(['image'], 'license.png', { type: 'image/png' })
    const result = await recognizeDocumentText(file)

    expect(result.confidence).toBeNull()
    expect(result.text).toBe('Personal code 39001010000')
  })

  it('throws AbortError when aborted before OCR starts', async () => {
    const controller = new AbortController()
    controller.abort()

    const file = new File(['image'], 'license.png', { type: 'image/png' })

    await expect(recognizeDocumentText(file, undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(createWorkerMock).not.toHaveBeenCalled()
  })

  it('terminates the worker and throws AbortError when aborted during OCR', async () => {
    const controller = new AbortController()
    const { terminate } = createMockWorker(
      () =>
        new Promise((resolve) => {
          controller.abort()
          resolve({
            data: { text: 'late result', confidence: 80 },
          })
        }),
    )

    const file = new File(['image'], 'license.png', { type: 'image/png' })

    await expect(recognizeDocumentText(file, undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(terminate).toHaveBeenCalled()
  })

  it('always terminates the worker in finally', async () => {
    const { terminate } = createMockWorker(async () => ({
      data: { text: 'done', confidence: 92 },
    }))

    const file = new File(['image'], 'license.png', { type: 'image/png' })
    await recognizeDocumentText(file)

    expect(terminate).toHaveBeenCalled()
  })

  it('propagates genuine OCR failures without converting them to AbortError', async () => {
    createWorkerMock.mockRejectedValue(new Error('Tesseract worker failed'))

    const file = new File(['image'], 'license.png', { type: 'image/png' })

    await expect(recognizeDocumentText(file)).rejects.toThrow('Tesseract worker failed')
    expect(createWorkerMock).toHaveBeenCalled()
  })
})
