import path from 'node:path'
import { existsSync } from 'node:fs'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

// Audio transcription using Python openai-whisper or faster-whisper.
// Falls back to detailed install instructions if neither is available.

async function detectWhisper(): Promise<'openai-whisper' | 'faster-whisper' | null> {
  // Try openai-whisper
  const check1 = await runTerminal({ command: 'python -c "import whisper; print(\'openai\')" 2>&1' })
  if (check1.includes('openai')) return 'openai-whisper'
  // Try faster-whisper
  const check2 = await runTerminal({ command: 'python -c "from faster_whisper import WhisperModel; print(\'faster\')" 2>&1' })
  if (check2.includes('faster')) return 'faster-whisper'
  return null
}

// ── transcribe_audio ──────────────────────────────────────────────────────────

export const transcribeAudioDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'transcribe_audio',
    description:
      'Transcribe an audio file to text using Whisper AI. Supports: .mp3 .wav .m4a .mp4 .ogg .flac .webm. Requires Python + openai-whisper (pip install openai-whisper) or faster-whisper.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the audio file to transcribe.' },
        model: { type: 'string', description: 'Whisper model size: tiny, base, small (default), medium, large. Larger = more accurate but slower.' },
        language: { type: 'string', description: 'Language code hint (e.g. "en", "es"). Auto-detected if omitted.' },
      },
      required: ['file'],
    },
  },
}

export const transcribeAudio: ToolHandler = async (args) => {
  const filePath = (args.file ?? '').trim()
  if (!filePath) return 'Error: file path is required'

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  if (!existsSync(absPath)) return `Error: file not found: ${absPath}`

  const model = args.model ?? 'small'
  const lang = args.language ? `--language ${args.language}` : ''

  const impl = await detectWhisper()
  if (!impl) {
    return [
      'Whisper is not installed. To enable audio transcription, run ONE of these:',
      '',
      '  pip install openai-whisper    # full Whisper (requires PyTorch ~2GB)',
      '  pip install faster-whisper    # faster, lighter alternative',
      '',
      'After installing, call transcribe_audio again.',
    ].join('\n')
  }

  if (impl === 'openai-whisper') {
    const script = `python -c "
import whisper, json, sys
m = whisper.load_model('${model}')
r = m.transcribe(r'${absPath.replace(/\\/g, '\\\\')}' ${lang ? `, language='${args.language}'` : ''})
print(r['text'].strip())
" 2>&1`
    const result = await runTerminal({ command: script })
    return result.trim() || '(empty transcription)'
  }

  // faster-whisper
  const script = `python -c "
from faster_whisper import WhisperModel
model = WhisperModel('${model}', device='cpu', compute_type='int8')
segs, info = model.transcribe(r'${absPath.replace(/\\/g, '\\\\')}' ${lang ? `, language='${args.language}'` : ''})
print(' '.join(s.text for s in segs).strip())
" 2>&1`
  const result = await runTerminal({ command: script })
  return result.trim() || '(empty transcription)'
}

// ── install_whisper ───────────────────────────────────────────────────────────

export const installWhisperDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'install_whisper',
    description: 'Install the faster-whisper Python package so transcribe_audio works. Takes a few minutes.',
    parameters: { type: 'object', properties: {} },
  },
}

export const installWhisper: ToolHandler = async (_args) => {
  return runTerminal({ command: 'pip install faster-whisper 2>&1' })
}
