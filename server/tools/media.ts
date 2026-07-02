import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

// ── ffmpeg check/install ───────────────────────────────────────────────────────

async function ensureFfmpeg(): Promise<string | null> {
  const check = await runTerminal({ command: 'Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source' })
  if (check.trim() && !check.includes('Error')) return check.trim()
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
