import type express from 'express'
import { recordRuntimeEvent } from './backendStatus.js'

export function sendEvent(response: express.Response, event: string, data: unknown): void {
  if (event === 'error') {
    const detail = typeof data === 'object' && data !== null && 'error' in data
      ? String((data as { error?: unknown }).error)
      : JSON.stringify(data)
    recordRuntimeEvent('sse', detail, 'error')
  }
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

// Pending ask_user answers: question ID → resolve callback
export const pendingAnswers = new Map<string, (answer: string) => void>()
