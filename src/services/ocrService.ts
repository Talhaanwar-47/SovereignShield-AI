import Tesseract from 'tesseract.js'

export type OcrProgressUpdate = {
  step: number
  message: string
}

export type OcrRecognitionResult = {
  text: string
  confidence: number | null
}

export const OCR_LOW_CONFIDENCE_THRESHOLD = 70

export function normalizeOcrConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return value
}

export function formatOcrConfidencePercent(confidence: number): string {
  return `${Math.round(confidence)}%`
}

export function isLowOcrConfidence(confidence: number | null): boolean {
  return confidence !== null && confidence < OCR_LOW_CONFIDENCE_THRESHOLD
}

export const OCR_LOADING_STEPS = [
  'Initializing AI OCR Vision layers...',
  'Scanning text vectors...',
  'Extracting secure fields...',
] as const

function mapTesseractProgress(
  status: string,
  progress: number,
): OcrProgressUpdate {
  const normalized = status.toLowerCase()

  if (
    normalized.includes('loading') ||
    normalized.includes('initializing') ||
    normalized.includes('loaded') ||
    progress < 0.35
  ) {
    return { step: 0, message: OCR_LOADING_STEPS[0] }
  }

  if (normalized.includes('recognizing') || progress < 0.9) {
    return { step: 1, message: OCR_LOADING_STEPS[1] }
  }

  return { step: 2, message: OCR_LOADING_STEPS[2] }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('OCR operation was aborted.', 'AbortError')
  }
}

export async function recognizeDocumentText(
  file: File,
  onProgress?: (update: OcrProgressUpdate) => void,
  signal?: AbortSignal,
): Promise<OcrRecognitionResult> {
  throwIfAborted(signal)

  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null
  let aborted = false

  const onAbort = () => {
    aborted = true
    void worker?.terminate()
  }

  signal?.addEventListener('abort', onAbort)

  try {
    worker = await Tesseract.createWorker('est+eng', 1, {
      logger: (message) => {
        if (aborted || signal?.aborted) return
        const mapped = mapTesseractProgress(message.status, message.progress)
        onProgress?.({
          step: mapped.step,
          message: mapped.message,
        })
      },
    })

    throwIfAborted(signal)

    const { data } = await worker.recognize(file)

    throwIfAborted(signal)

    return {
      text: data.text,
      confidence: normalizeOcrConfidence(data.confidence),
    }
  } catch (err) {
    if (aborted || signal?.aborted) {
      throw new DOMException('OCR operation was aborted.', 'AbortError')
    }
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (worker) {
      await worker.terminate()
    }
  }
}
