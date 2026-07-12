import path, { join } from 'node:path'
import { homedir } from 'node:os'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

function cleanOutput(output: string): string {
  return output
    .replace(/\n\[exit code [^\]]+\]/g, '')
    .replace(/\n\[shell [^\]]+\]$/g, '')
    .trim()
}

function parseFfmpegProgress(output: string): string | null {
  const frameMatches = [...output.matchAll(/frame=\s*(\d+).*?time=\s*([0-9:.]+)/g)]
  if (frameMatches.length > 0) {
    const last = frameMatches[frameMatches.length - 1]
    return `Encoded ${last[1]} frames, ~${last[2]} of output`
  }
  const timeMatches = [...output.matchAll(/time=\s*([0-9:.]+)/g)]
  if (timeMatches.length > 0) {
    return `Processed ~${timeMatches[timeMatches.length - 1][1]} of output`
  }
  return null
}

function getPresetFlags(preset: string | undefined): string | null {
  switch ((preset ?? '').trim().toLowerCase()) {
    case '720p':
      return '-vf scale=-2:720 -c:v libx264 -crf 23 -c:a aac'
    case '1080p':
      return '-vf scale=-2:1080 -c:v libx264 -crf 20 -c:a aac'
    case '480p':
      return '-vf scale=-2:480 -c:v libx264 -crf 28 -c:a aac'
    case 'audio-only':
      return '-vn -c:a mp3 -q:a 2'
    case 'compress':
      return '-c:v libx264 -crf 28 -c:a aac -b:a 128k'
    case 'gif':
      return '-vf "fps=10,scale=480:-1:flags=lanczos" -loop 0'
    default:
      return null
  }
}

async function ensureFfmpeg(): Promise<string | null> {
  const check = await runTerminal({ command: 'Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source' })
  const cleaned = cleanOutput(check)
  if (cleaned && !cleaned.includes('Error')) return cleaned
  return null
}

async function ensureFfprobe(): Promise<string | null> {
  const check = await runTerminal({ command: 'Get-Command ffprobe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source' })
  const cleaned = cleanOutput(check)
  if (cleaned && !cleaned.includes('Error')) return cleaned
  return null
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

  const fps = (1 / spi).toFixed(4)
  const audioFlag = audio ? ` -i "${audio}" -shortest` : ''
  const pngCmd = `& ffmpeg -y -framerate ${fps} -pattern_type glob -i "${folder}/*.png" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p${audioFlag} "${outPath}" 2>&1`
  const jpgCmd = `& ffmpeg -y -framerate ${fps} -pattern_type glob -i "${folder}/*.jpg" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p${audioFlag} "${outPath}" 2>&1`

  let result = await runTerminal({ command: pngCmd, max_output_chars: '120000' })
  if (result.includes('Error') && !result.includes('frame=')) {
    result = await runTerminal({ command: jpgCmd, max_output_chars: '120000' })
    if (result.includes('Error') && !result.includes('frame=')) return `ffmpeg error: ${cleanOutput(result)}`
  }

  const progress = parseFfmpegProgress(result)
  await runTerminal({ command: `Start-Process "${outPath}"` })
  return progress
    ? `Slideshow created: ${outPath}\n${progress}`
    : `Slideshow created: ${outPath}`
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

  const cmd = `& ffmpeg -y -f gdigrab -framerate 30 -t ${seconds} -i desktop -vcodec libx264 -preset ultrafast "${outPath}" 2>&1`
  const result = await runTerminal({ command: cmd })

  if (result.includes('Error') && !result.includes('frame=')) {
    return `Screen recording failed: ${cleanOutput(result)}`
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
        options: { type: 'string', description: 'Extra ffmpeg flags, e.g. "-vf scale=640:-1". Ignored when preset is set.' },
        preset: {
          type: 'string',
          description: 'Optional preset that overrides ffmpeg flags.',
          enum: ['720p', '1080p', '480p', 'audio-only', 'compress', 'gif'],
        },
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
  const presetFlags = getPresetFlags(args.preset)
  const extra = presetFlags ?? (args.options ?? '').trim()

  const cmd = `& ffmpeg -y -i "${input}"${startFlag}${durFlag}${extra ? ` ${extra}` : ''} "${output}" 2>&1`
  const result = await runTerminal({ command: cmd, max_output_chars: '120000' })

  if (result.includes('Error') && !result.includes('frame=') && !result.includes('size=')) {
    return `ffmpeg error: ${cleanOutput(result).slice(-500)}`
  }

  const progress = parseFfmpegProgress(result)
  return progress ? `Done: ${output}\n${progress}` : `Done: ${output}`
}

// ── probe_media ───────────────────────────────────────────────────────────────

export const probeMediaDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'probe_media',
    description: 'Inspect a media file with ffprobe and return structured stream and format details.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path to the media file.' },
      },
      required: ['input'],
    },
  },
}

export const probeMedia: ToolHandler = async (args) => {
  const input = (args.input ?? '').trim()
  if (!input) return 'Error: input path is required'

  const ffprobePath = await ensureFfprobe()
  if (!ffprobePath) {
    const fallback = await runTerminal({ command: `& ffmpeg -i "${input}" 2>&1`, max_output_chars: '40000' })
    return `ffprobe is not installed. Plain output:\n${cleanOutput(fallback)}`
  }

  const raw = await runTerminal({
    command: `& ffprobe -v quiet -print_format json -show_streams -show_format "${input}"`,
    max_output_chars: '120000',
  })
  const cleaned = cleanOutput(raw)

  try {
    const data = JSON.parse(cleaned) as {
      streams?: Array<Record<string, unknown>>
      format?: Record<string, unknown>
    }
    const videoStream = (data.streams ?? []).find((stream) => stream.codec_type === 'video')
    const audioStream = (data.streams ?? []).find((stream) => stream.codec_type === 'audio')
    return JSON.stringify({
      duration: data.format?.duration ?? null,
      width: typeof videoStream?.width === 'number' ? videoStream.width : null,
      height: typeof videoStream?.height === 'number' ? videoStream.height : null,
      codec: videoStream?.codec_name ?? audioStream?.codec_name ?? null,
      bitrate: data.format?.bit_rate ?? null,
      fileSize: data.format?.size ?? null,
      streams: data.streams ?? [],
    }, null, 2)
  } catch {
    return `ffprobe output:\n${cleaned}`
  }
}

// ── trim_video ────────────────────────────────────────────────────────────────

export const trimVideoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'trim_video',
    description: 'Trim a clip from a video and save it to Desktop using ffmpeg stream copy.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input video file path.' },
        start: { type: 'string', description: 'Clip start time in seconds or HH:MM:SS.' },
        end: { type: 'string', description: 'Clip end time in seconds or HH:MM:SS.' },
        output: { type: 'string', description: 'Output filename without extension. Saved to Desktop.' },
      },
      required: ['input', 'start', 'end', 'output'],
    },
  },
}

export const trimVideo: ToolHandler = async (args) => {
  const ffmpegPath = await ensureFfmpeg()
  if (!ffmpegPath) return 'ffmpeg is not installed. Run: winget install ffmpeg'

  const input = (args.input ?? '').trim()
  const start = (args.start ?? '').trim()
  const end = (args.end ?? '').trim()
  const outputName = (args.output ?? '').trim()
  if (!input || !start || !end || !outputName) return 'Error: input, start, end, and output are required'

  const ext = path.extname(input) || '.mp4'
  const outPath = join(homedir(), 'Desktop', `${outputName}${ext}`)
  const result = await runTerminal({
    command: `& ffmpeg -y -ss ${start} -to ${end} -i "${input}" -c copy "${outPath}" 2>&1`,
    max_output_chars: '120000',
  })

  if (result.includes('Error') && !result.includes('frame=') && !result.includes('size=')) {
    return `ffmpeg error: ${cleanOutput(result)}`
  }

  const progress = parseFfmpegProgress(result)
  return progress ? `Trimmed video saved: ${outPath}\n${progress}` : `Trimmed video saved: ${outPath}`
}
