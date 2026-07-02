import { readFile } from 'node:fs/promises'
import type { ToolDefinition, ToolHandler } from './types.js'

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'

// Prefer smaller/faster vision models first, fall back to larger ones
const VISION_MODEL_PREFERENCE = ['moondream', 'llava-phi3', 'llava:7b', 'llava', 'llava:13b']

async function pickVisionModel(): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data = await res.json() as { models?: Array<{ name: string }> }
    const names = (data.models ?? []).map((m) => m.name.toLowerCase())
    for (const pref of VISION_MODEL_PREFERENCE) {
      if (names.some((n) => n.includes(pref.replace(':7b', '').replace(':13b', '')))) {
        const match = names.find((n) => n.includes(pref.replace(':7b', '').replace(':13b', '')))
        return (data.models ?? []).find((m) => m.name.toLowerCase() === match)?.name ?? null
      }
    }
    return null
  } catch {
    return null
  }
}

// ── analyze_image ─────────────────────────────────────────────────────────────

export const analyzeImageDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'analyze_image',
    description:
      'Analyze an image file using a local vision AI model (llava/moondream via Ollama). Can describe images, read text in images, answer questions about what is shown.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the image file (PNG, JPG, etc.).' },
        question: {
          type: 'string',
          description: 'What to ask about the image. Default: "Describe this image in detail."',
        },
      },
      required: ['path'],
    },
  },
}

export const analyzeImage: ToolHandler = async (args) => {
  const imagePath = (args.path ?? '').trim()
  const question = (args.question ?? 'Describe this image in detail.').trim()
  if (!imagePath) return 'Error: no image path provided'

  const model = await pickVisionModel()
  if (!model) {
    return [
      'No vision model found. Pull one first:',
      '  ollama pull llava',
      '  ollama pull moondream',
      'Then try again.',
    ].join('\n')
  }

  let imageBase64: string
  try {
    const buf = await readFile(imagePath)
    imageBase64 = buf.toString('base64')
  } catch (err) {
    return `Error reading image file: ${err instanceof Error ? err.message : String(err)}`
  }

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: question, images: [imageBase64] }],
        stream: false,
        options: { num_ctx: 4096 },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return `Vision model error (HTTP ${res.status}): ${body}`
    }
    const data = await res.json() as { message?: { content?: string } }
    return `[Vision model: ${model}]\n\n${data.message?.content ?? 'No response.'}`
  } catch (err) {
    return `Vision call failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── screen_read ───────────────────────────────────────────────────────────────
// Convenience: take a screenshot then analyze it in one step

export const screenReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'screen_read',
    description:
      'Take a screenshot of the current screen and analyze it with vision AI. Useful for "what do you see on screen?" or reading UI elements.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'What to ask about the screen. Default: "Describe what is on the screen."',
        },
      },
      required: [],
    },
  },
}

export const screenRead: ToolHandler = async (args) => {
  const question = (args.question ?? 'Describe everything visible on the screen.').trim()
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const { runTerminal } = await import('./terminal.js')

  const tempPath = join(homedir(), 'Desktop', `_screen_read_${Date.now()}.png`)
  const escapedPath = tempPath.replace(/\\/g, '\\\\')

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
    '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
    `$bmp.Save("${escapedPath}")`,
    '$g.Dispose(); $bmp.Dispose()',
    "Write-Output 'Screenshot captured'",
  ].join('; ')

  const screenshotResult = await runTerminal({ command: script })
  if (screenshotResult.includes('Error')) return screenshotResult

  const visionResult = await analyzeImage({ path: tempPath, question })

  // Clean up temp file
  await runTerminal({ command: `Remove-Item -Path "${escapedPath}" -ErrorAction SilentlyContinue` })

  return visionResult
}
