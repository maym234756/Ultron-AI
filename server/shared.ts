import type express from 'express'

export function sendEvent(response: express.Response, event: string, data: unknown): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

// Pending ask_user answers: question ID → resolve callback
export const pendingAnswers = new Map<string, (answer: string) => void>()
