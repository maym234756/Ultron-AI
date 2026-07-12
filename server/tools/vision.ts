import { spawn } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import type { ToolDefinition, ToolHandler } from './types.js'

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'

const VISION_MODEL_PREFERENCE = ['moondream', 'llava-phi3', 'llava:7b', 'llava', 'llava:13b']
const OCR_PROMPT = 'Extract and return ALL text visible in this image. Include every word, number, and symbol exactly as shown. Format as plain text.'
const NO_MODEL_MESSAGE = 'No vision model available. Run: ollama pull llava OR ollama pull moondream'

type VisionModelSelection = {
  model: string | null
  message?: string
}

type VisionRegion = {
  x: number
  y: number
  width: number
  height: number
}

function isWindows(): boolean {
  return platform() === 'win32'
}

function isMac(): boolean {
  return platform() === 'darwin'
}

function isLinux(): boolean {
  return platform() === 'linux'
}

async function pickVisionModel(): Promise<VisionModelSelection> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { model: null, message: NO_MODEL_MESSAGE }
    const data = await res.json() as { models?: Array<{ name: string }> }
    const models = data.models ?? []
    const names = models.map((m) => m.name.toLowerCase())
    for (const pref of VISION_MODEL_PREFERENCE) {
      const token = pref.replace(':7b', '').replace(':13b', '')
      const match = names.find((n) => n.includes(token))
      if (match) {
        return { model: models.find((m) => m.name.toLowerCase() === match)?.name ?? null }
      }
    }
    return { model: null, message: NO_MODEL_MESSAGE }
  } catch {
    return { model: null, message: NO_MODEL_MESSAGE }
  }
}

async function callVisionModel(model: string, messages: Array<Record<string, unknown>>): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { num_ctx: 4096 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Vision model error (HTTP ${res.status}): ${body}`)
  }
  const data = await res.json() as { message?: { content?: string } }
  return (data.message?.content ?? 'No response.').trim()
}

function parseRegion(regionRaw: string | undefined): VisionRegion | null {
  if (!regionRaw?.trim()) return null
  try {
    const parsed = JSON.parse(regionRaw) as Partial<VisionRegion>
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return parsed as VisionRegion
    }
  } catch {
    return null
  }
  return null
}

async function loadImageBase64(imagePath: string, regionRaw: string | undefined): Promise<{ imageBase64: string, note?: string }> {
  const buf = await readFile(imagePath)
  const region = parseRegion(regionRaw)
  if (!region) {
    return { imageBase64: buf.toString('base64') }
  }

  try {
    const dynamicImport = new Function('name', 'return import(name)') as (name: string) => Promise<any>
    const sharpModule = await dynamicImport('sharp')
    const sharpLib = sharpModule.default ?? sharpModule
    const cropped = await sharpLib(buf).extract(region).toBuffer()
    return {
      imageBase64: cropped.toString('base64'),
      note: `Region applied: ${JSON.stringify(region)}`,
    }
  } catch {
    return {
      imageBase64: buf.toString('base64'),
      note: 'Region support requires sharp (npm install sharp). Analyzed the full image instead.',
    }
  }
}

function buildQuestion(question: string | undefined, mode: string | undefined): string {
  if ((mode ?? '').trim().toLowerCase() === 'ocr') return OCR_PROMPT
  return (question ?? 'Describe this image in detail.').trim()
}

async function analyzeImageInternal(args: Record<string, string>): Promise<string> {
  const imagePath = (args.path ?? '').trim()
  const question = buildQuestion(args.question, args.mode)
  const includeConfidence = (args.include_confidence ?? '').trim().toLowerCase() === 'true'
  if (!imagePath) return 'Error: no image path provided'

  const selection = await pickVisionModel()
  if (!selection.model) {
    return selection.message ?? NO_MODEL_MESSAGE
  }

  let prepared
  try {
    prepared = await loadImageBase64(imagePath, args.region)
  } catch (err) {
    return `Error reading image file: ${err instanceof Error ? err.message : String(err)}`
  }

  try {
    const baseMessages: Array<Record<string, unknown>> = [{ role: 'user', content: question, images: [prepared.imageBase64] }]
    const response = await callVisionModel(selection.model, baseMessages)
    const parts = [response]

    if (includeConfidence) {
      const confidence = await callVisionModel(selection.model, [
        ...baseMessages,
        { role: 'assistant', content: response },
        { role: 'user', content: 'On a scale of 1-10, how confident are you in the above analysis? Respond with just a number.' },
      ])
      parts.push(`Confidence: ${confidence}`)
    }

    if (prepared.note) parts.push(prepared.note)
    parts.push(`Model: ${selection.model}`)
    return parts.join('\n\n')
  } catch (err) {
    return `Vision call failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      proc.kill('SIGTERM')
      resolve('Error: command timed out after 30 seconds')
    }, 30_000)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim()
      if (code && code !== 0) {
        resolve(`Error: ${output || `command exited with code ${code}`}`)
        return
      }
      resolve(output || 'OK')
    })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(`Error: ${err.message}`)
    })
  })
}

async function captureScreenshot(outputPath: string): Promise<string> {
  if (isWindows()) {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
      `$bmp.Save('${outputPath.replace(/'/g, "''")}')`,
      '$g.Dispose(); $bmp.Dispose()',
      "Write-Output 'Screenshot captured'",
    ].join('; ')
    return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script])
  }

  if (isMac()) {
    return runProcess('screencapture', ['-x', outputPath])
  }

  if (isLinux()) {
    const first = await runProcess('scrot', [outputPath])
    if (!first.startsWith('Error:')) return first
    const second = await runProcess('gnome-screenshot', ['-f', outputPath])
    if (!second.startsWith('Error:')) return second
    return `${first}\n${second}`
  }

  return `Error: unsupported platform: ${platform()}`
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
        mode: {
          type: 'string',
          description: 'describe (default) or ocr.',
          enum: ['describe', 'ocr'],
        },
        include_confidence: {
          type: 'string',
          description: 'When true, also ask the model for a 1-10 confidence score.',
        },
        region: {
          type: 'string',
          description: 'Optional crop region JSON, e.g. {"x":0,"y":0,"width":100,"height":100}.',
        },
      },
      required: ['path'],
    },
  },
}

export const analyzeImage: ToolHandler = async (args) => analyzeImageInternal(args)

// ── analyze_screenshot ────────────────────────────────────────────────────────

export const analyzeScreenshotDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'analyze_screenshot',
    description: 'Capture a screenshot, then analyze it with the local vision model.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Optional question about the screenshot.',
        },
        mode: {
          type: 'string',
          description: 'describe (default) or ocr.',
          enum: ['describe', 'ocr'],
        },
      },
    },
  },
}

export const analyzeScreenshot: ToolHandler = async (args) => {
  const tempPath = join(homedir(), 'Desktop', `_analyze_screenshot_${Date.now()}.png`)
  const captureResult = await captureScreenshot(tempPath)
  if (captureResult.startsWith('Error:')) return captureResult

  try {
    return await analyzeImageInternal({
      path: tempPath,
      question: args.question ?? 'Describe what is visible in this screenshot.',
      mode: args.mode ?? 'describe',
    })
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}

// ── screen_read ───────────────────────────────────────────────────────────────

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

export const screenRead: ToolHandler = async (args) => analyzeScreenshot({
  question: args.question ?? 'Describe everything visible on the screen.',
  mode: 'describe',
})
