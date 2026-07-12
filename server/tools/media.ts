import fs from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

const ROOT = process.cwd()

function resolveInputPath(inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(ROOT, inputPath)
}

function psEscape(value: string): string {
  return value.replace(/'/g, "''")
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

// ── ffmpeg check/install ───────────────────────────────────────────────────────

async function ensureFfmpeg(): Promise<string | null> {
  const check = await runTerminal({ command: 'Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source' })
  if (check.trim() && !check.includes('Error')) return check.trim()
  return null
}

async function ensureFfprobe(): Promise<string | null> {
  const check = await runTerminal({ command: 'Get-Command ffprobe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source' })
  if (check.trim() && !check.includes('Error')) return check.trim()
  return null
}

async function generatePhotoFile(prompt: string, dest: string, width: number, height: number, seed?: string): Promise<string> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${encodeURIComponent(seed ?? String(Math.floor(Math.random() * 999999)))}`
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  await fs.writeFile(dest, Buffer.from(buf))
  return dest
}

async function readPdfSummary(filePath: string, maxChars: number): Promise<string> {
  const req = createRequire(import.meta.url)
  const pdfParse = req('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number; info?: Record<string, unknown>; metadata?: unknown }>
  const buf = await fs.readFile(filePath)
  const result = await pdfParse(buf)
  const text = result.text.replace(/\s+\n/g, '\n').trim()
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0
  const preview = text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text
  const info = result.info ? JSON.stringify(result.info, null, 2).slice(0, 1200) : 'No embedded info metadata.'
  return [
    `PDF: ${filePath}`,
    `Pages: ${result.numpages}`,
    `Bytes: ${buf.length.toLocaleString()}`,
    `Estimated words: ${words.toLocaleString()}`,
    '',
    'Metadata:',
    info,
    '',
    'Text preview:',
    preview || '[no extractable text found]',
  ].join('\n')
}

// -- scan_media_file -----------------------------------------------------------

export const scanMediaFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'scan_media_file',
    description: 'Inspect a photo, video, audio file, or PDF. Returns file metadata, image dimensions, video/audio streams, duration, or PDF text summary.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the media file.' },
        max_text_chars: { type: 'string', description: 'For PDFs, maximum extracted text preview characters (default 5000).' },
      },
      required: ['path'],
    },
  },
}

export const scanMediaFile: ToolHandler = async (args) => {
  const input = (args.path ?? '').trim()
  if (!input) return 'Error: path is required'
  const filePath = resolveInputPath(input)
  try {
    const stat = await fs.stat(filePath)
    const ext = extname(filePath).toLowerCase()

    if (ext === '.pdf') {
      return readPdfSummary(filePath, clampInt(args.max_text_chars, 5000, 500, 20000))
    }

    if (['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff'].includes(ext)) {
      const script = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${psEscape(filePath)}')
try {
  [PSCustomObject]@{
    Path='${psEscape(filePath)}'
    Bytes=${stat.size}
    Width=$img.Width
    Height=$img.Height
    PixelFormat=$img.PixelFormat.ToString()
    HorizontalResolution=$img.HorizontalResolution
    VerticalResolution=$img.VerticalResolution
    FrameDimensions=$img.FrameDimensionsList.Count
  } | ConvertTo-Json -Depth 3
} finally { $img.Dispose() }
`.trim()
      return runTerminal({ command: script })
    }

    if (['.mp4', '.mov', '.mkv', '.webm', '.avi', '.mp3', '.wav', '.m4a', '.flac'].includes(ext)) {
      const ffprobePath = await ensureFfprobe()
      if (!ffprobePath) return `File: ${filePath}\nBytes: ${stat.size.toLocaleString()}\nffprobe is not installed. Install ffmpeg to inspect streams and duration.`
      const cmd = `& ffprobe -v error -show_format -show_streams -print_format json "${filePath}" 2>&1`
      const raw = await runTerminal({ command: cmd, max_output_chars: '40000' })
      try {
        const parsed = JSON.parse(raw) as { format?: { duration?: string; bit_rate?: string; format_name?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string; channels?: number }> }
        const streams = parsed.streams ?? []
        const streamRows = streams.map((stream, index) => {
          const dims = stream.width && stream.height ? ` ${stream.width}x${stream.height}` : ''
          const rate = stream.avg_frame_rate && stream.avg_frame_rate !== '0/0' ? ` fps=${stream.avg_frame_rate}` : ''
          const audio = stream.sample_rate ? ` sample_rate=${stream.sample_rate} channels=${stream.channels ?? 'unknown'}` : ''
          return `  [${index}] ${stream.codec_type ?? 'unknown'} ${stream.codec_name ?? 'unknown'}${dims}${rate}${audio}`
        }).join('\n')
        return [
          `Media: ${filePath}`,
          `Bytes: ${stat.size.toLocaleString()}`,
          `Format: ${parsed.format?.format_name ?? 'unknown'}`,
          `Duration: ${parsed.format?.duration ? `${Number(parsed.format.duration).toFixed(2)}s` : 'unknown'}`,
          `Bitrate: ${parsed.format?.bit_rate ?? 'unknown'}`,
          'Streams:',
          streamRows || '  none reported',
        ].join('\n')
      } catch {
        return raw.slice(0, 12000)
      }
    }

    return `File: ${filePath}\nName: ${basename(filePath)}\nExtension: ${ext || '[none]'}\nBytes: ${stat.size.toLocaleString()}\nModified: ${stat.mtime.toISOString()}`
  } catch (err) {
    return `Scan failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// -- view_media ----------------------------------------------------------------

export const viewMediaDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'view_media',
    description: 'Open a photo, video, audio file, or PDF in the default Windows viewer. Useful for quickly reviewing generated or scanned media.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the media file.' },
      },
      required: ['path'],
    },
  },
}

export const viewMedia: ToolHandler = async (args) => {
  const input = (args.path ?? '').trim()
  if (!input) return 'Error: path is required'
  const filePath = resolveInputPath(input)
  try {
    await fs.access(filePath)
    await runTerminal({ command: `Start-Process "${filePath}"` })
    return `Opened media file: ${filePath}`
  } catch (err) {
    return `Open failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// -- scan_pdf_document ---------------------------------------------------------

export const scanPdfDocumentDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'scan_pdf_document',
    description: 'Extract PDF metadata, page count, word count, and a text preview for document review or search indexing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the PDF file.' },
        max_text_chars: { type: 'string', description: 'Maximum extracted text preview characters (default 8000).' },
      },
      required: ['path'],
    },
  },
}

export const scanPdfDocument: ToolHandler = async (args) => {
  const input = (args.path ?? '').trim()
  if (!input) return 'Error: path is required'
  try {
    return readPdfSummary(resolveInputPath(input), clampInt(args.max_text_chars, 8000, 500, 40000))
  } catch (err) {
    return `PDF scan failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// -- generate_photo ------------------------------------------------------------

export const generatePhotoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_photo',
    description: 'Generate a realistic AI photo from a prompt, save it to Desktop, and open it. Uses Pollinations.ai and requires internet access.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Photo prompt. Include subject, style, lighting, camera/lens, realism, and composition.' },
        filename: { type: 'string', description: 'Output filename without extension. Defaults to photo_<timestamp>.' },
        width: { type: 'string', description: 'Width in pixels, default 1024.' },
        height: { type: 'string', description: 'Height in pixels, default 1024.' },
        seed: { type: 'string', description: 'Optional deterministic seed.' },
      },
      required: ['prompt'],
    },
  },
}

export const generatePhoto: ToolHandler = async (args) => {
  const prompt = (args.prompt ?? '').trim()
  if (!prompt) return 'Error: prompt is required'
  const width = clampInt(args.width, 1024, 256, 2048)
  const height = clampInt(args.height, 1024, 256, 2048)
  const name = (args.filename ?? '').trim() || `photo_${Date.now()}`
  const dest = join(homedir(), 'Desktop', `${name}.png`)
  try {
    await generatePhotoFile(prompt, dest, width, height, args.seed)
    await runTerminal({ command: `Start-Process "${dest}"` })
    return `Photo generated: ${dest}`
  } catch (err) {
    return `Photo generation failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// -- extract_video_frames ------------------------------------------------------

export const extractVideoFramesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'extract_video_frames',
    description: 'Extract thumbnail frames from a video for scanning, review, or visual search. Saves JPG frames to Desktop.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input video file path.' },
        output_folder: { type: 'string', description: 'Output folder path. Defaults to Desktop/video_frames_<timestamp>.' },
        every_seconds: { type: 'string', description: 'Extract one frame every N seconds, default 5.' },
        max_frames: { type: 'string', description: 'Maximum frames to extract, default 24.' },
      },
      required: ['input'],
    },
  },
}

export const extractVideoFrames: ToolHandler = async (args) => {
  const input = (args.input ?? '').trim()
  if (!input) return 'Error: input is required'
  const ffmpegPath = await ensureFfmpeg()
  if (!ffmpegPath) return 'ffmpeg is not installed. Run: winget install ffmpeg'
  const filePath = resolveInputPath(input)
  const folder = args.output_folder?.trim() ? resolveInputPath(args.output_folder) : join(homedir(), 'Desktop', `video_frames_${Date.now()}`)
  const everySeconds = clampInt(args.every_seconds, 5, 1, 120)
  const maxFrames = clampInt(args.max_frames, 24, 1, 200)
  await fs.mkdir(folder, { recursive: true })
  const cmd = `& ffmpeg -y -i "${filePath}" -vf "fps=1/${everySeconds},scale=960:-1" -frames:v ${maxFrames} "${join(folder, 'frame_%04d.jpg')}" 2>&1`
  const result = await runTerminal({ command: cmd, max_output_chars: '12000' })
  if (result.includes('Error') && !result.includes('frame=')) return `Frame extraction failed: ${result}`
  await runTerminal({ command: `Start-Process "${folder}"` })
  return `Extracted up to ${maxFrames} frame(s) to: ${folder}`
}

// -- generate_ai_video_storyboard ---------------------------------------------

export const generateAiVideoStoryboardDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_ai_video_storyboard',
    description: 'Generate AI scene images from a prompt and stitch them into an MP4 with ffmpeg. This creates a cinematic storyboard video, not full motion diffusion video.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Video concept. Describe subject, setting, camera style, lighting, and mood.' },
        output: { type: 'string', description: 'Output video filename without extension. Saved to Desktop.' },
        scenes: { type: 'string', description: 'Number of generated scene frames, default 6, max 16.' },
        seconds_per_scene: { type: 'string', description: 'Seconds per scene, default 2.' },
        width: { type: 'string', description: 'Frame width, default 1280.' },
        height: { type: 'string', description: 'Frame height, default 720.' },
      },
      required: ['prompt'],
    },
  },
}

export const generateAiVideoStoryboard: ToolHandler = async (args) => {
  const prompt = (args.prompt ?? '').trim()
  if (!prompt) return 'Error: prompt is required'
  const ffmpegPath = await ensureFfmpeg()
  if (!ffmpegPath) return 'ffmpeg is not installed. Run: winget install ffmpeg'
  const scenes = clampInt(args.scenes, 6, 2, 16)
  const secondsPerScene = clampInt(args.seconds_per_scene, 2, 1, 10)
  const width = clampInt(args.width, 1280, 512, 1920)
  const height = clampInt(args.height, 720, 512, 1080)
  const name = (args.output ?? '').trim() || `ai_video_${Date.now()}`
  const workDir = join(homedir(), 'Desktop', `${name}_frames`)
  const outPath = join(homedir(), 'Desktop', `${name}.mp4`)
  await fs.mkdir(workDir, { recursive: true })

  try {
    for (let index = 1; index <= scenes; index++) {
      const scenePrompt = `${prompt}. Cinematic realistic video still, scene ${index} of ${scenes}, natural motion blur, detailed lighting, high realism, no text.`
      const framePath = join(workDir, `frame_${String(index).padStart(4, '0')}.png`)
      await generatePhotoFile(scenePrompt, framePath, width, height, `${Date.now()}-${index}`)
    }
    const fps = (1 / secondsPerScene).toFixed(4)
    const cmd = `& ffmpeg -y -framerate ${fps} -i "${join(workDir, 'frame_%04d.png')}" -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -c:v libx264 -pix_fmt yuv420p "${outPath}" 2>&1`
    const result = await runTerminal({ command: cmd, timeout_sec: '180', max_output_chars: '20000' })
    if (result.includes('Error') && !result.includes('frame=')) return `AI video storyboard failed during encoding: ${result}`
    await runTerminal({ command: `Start-Process "${outPath}"` })
    return `AI storyboard video generated: ${outPath}\nFrames: ${workDir}`
  } catch (err) {
    return `AI video storyboard failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── create_slideshow ──────────────────────────────────────────────────────────

export const createSlideshowDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_slideshow',
    description:
      'Create a video slideshow from a folder of images using ffmpeg. Each image is shown for a set number of seconds. Output is saved to Desktop.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Path to folder containing images.' },
        output: { type: 'string', description: 'Output video filename (no extension). Saved to Desktop.' },
        seconds_per_image: { type: 'string', description: 'Seconds each image is shown (default 3).' },
        audio: { type: 'string', description: 'Optional path to an audio file to add as background music.' },
      },
      required: ['folder'],
    },
  },
}

export const createSlideshow: ToolHandler = async (args) => {
  const ffmpegPath = await ensureFfmpeg()
  if (!ffmpegPath) {
    return [
      'ffmpeg is not installed. Install it with:',
      '  winget install ffmpeg',
      'Then try again.',
    ].join('\n')
  }

  const folder = (args.folder ?? '').trim()
  const name = (args.output ?? 'slideshow').trim() || 'slideshow'
  const spi = parseFloat(args.seconds_per_image ?? '3') || 3
  const outPath = join(homedir(), 'Desktop', `${name}.mp4`)
  const audio = (args.audio ?? '').trim()

  // Build ffmpeg command: glob pattern for images, fps = 1/seconds_per_image
  const fps = (1 / spi).toFixed(4)
  const audioFlag = audio ? ` -i "${audio}" -shortest` : ''
  const cmd = `& ffmpeg -y -framerate ${fps} -pattern_type glob -i "${folder}/*.png" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p${audioFlag} "${outPath}" 2>&1`

  const result = await runTerminal({ command: cmd })

  if (result.includes('Error') && !result.includes('frame=')) {
    // Try jpg pattern as fallback
    const cmd2 = `& ffmpeg -y -framerate ${fps} -pattern_type glob -i "${folder}/*.jpg" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p${audioFlag} "${outPath}" 2>&1`
    const result2 = await runTerminal({ command: cmd2 })
    if (result2.includes('Error')) return `ffmpeg error: ${result2}`
  }

  await runTerminal({ command: `Start-Process "${outPath}"` })
  return `Slideshow created: ${outPath}`
}

// ── record_screen ─────────────────────────────────────────────────────────────

export const recordScreenDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'record_screen',
    description: 'Record the screen for a number of seconds using ffmpeg. Saves to Desktop.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'string', description: 'How many seconds to record (default 10).' },
        output: { type: 'string', description: 'Output filename (no extension). Saved to Desktop.' },
      },
      required: [],
    },
  },
}

export const recordScreen: ToolHandler = async (args) => {
  const ffmpegPath = await ensureFfmpeg()
  if (!ffmpegPath) {
    return 'ffmpeg is not installed. Run: winget install ffmpeg'
  }

  const seconds = parseInt(args.seconds ?? '10', 10) || 10
  const name = (args.output ?? 'recording').trim() || 'recording'
  const outPath = join(homedir(), 'Desktop', `${name}.mp4`)

  // Use gdigrab (Windows screen capture) with ffmpeg
  const cmd = `& ffmpeg -y -f gdigrab -framerate 30 -t ${seconds} -i desktop -vcodec libx264 -preset ultrafast "${outPath}" 2>&1`
  const result = await runTerminal({ command: cmd })

  if (result.includes('Error') && !result.includes('frame=')) {
    return `Screen recording failed: ${result}`
  }

  await runTerminal({ command: `Start-Process "${outPath}"` })
  return `Screen recording saved: ${outPath} (${seconds}s)`
}

// ── convert_video ─────────────────────────────────────────────────────────────

export const convertVideoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'convert_video',
    description: 'Convert or trim a video file using ffmpeg. Can change format, extract clips, resize.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input video file path.' },
        output: { type: 'string', description: 'Output file path (include extension, e.g. out.gif).' },
        start: { type: 'string', description: 'Start time (e.g. 00:00:05). Optional.' },
        duration: { type: 'string', description: 'Duration to extract (e.g. 10 for 10 seconds). Optional.' },
        options: { type: 'string', description: 'Extra ffmpeg flags, e.g. "-vf scale=640:-1".' },
      },
      required: ['input', 'output'],
    },
  },
}

export const convertVideo: ToolHandler = async (args) => {
  const ffmpegPath = await ensureFfmpeg()
  if (!ffmpegPath) return 'ffmpeg is not installed. Run: winget install ffmpeg'

  const input = (args.input ?? '').trim()
  const output = (args.output ?? '').trim()
  if (!input || !output) return 'Error: input and output paths are required'

  const startFlag = args.start ? ` -ss ${args.start}` : ''
  const durFlag = args.duration ? ` -t ${args.duration}` : ''
  const extra = (args.options ?? '').trim()

  const cmd = `& ffmpeg -y -i "${input}"${startFlag}${durFlag} ${extra} "${output}" 2>&1`
  const result = await runTerminal({ command: cmd })

  if (result.includes('Error') && !result.includes('frame=') && !result.includes('size=')) {
    return `ffmpeg error: ${result.slice(-500)}`
  }

  return `Done: ${output}`
}
