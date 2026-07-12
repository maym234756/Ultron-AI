import path from 'node:path'
import { existsSync } from 'node:fs'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

function cleanOutput(output: string): string {
  return output
    .replace(/\n\[exit code [^\]]+\]/g, '')
    .replace(/\n\[shell [^\]]+\]$/g, '')
    .trim()
}

function escapePythonLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function detectWhisper(): Promise<'openai-whisper' | 'faster-whisper' | null> {
  const check1 = await runTerminal({ command: 'python -c "import whisper; print(\'openai\')" 2>&1' })
  if (check1.includes('openai')) return 'openai-whisper'
  const check2 = await runTerminal({ command: 'python -c "from faster_whisper import WhisperModel; print(\'faster\')" 2>&1' })
  if (check2.includes('faster')) return 'faster-whisper'
  return null
}

function buildOpenAiWhisperCommand(absPath: string, model: string, language: string | undefined, timestamps: boolean): string {
  const langArg = language ? `, language='${escapePythonLiteral(language)}'` : ''
  const timestampArg = timestamps ? ', word_timestamps=True' : ''
  return `python -c "
import whisper
def fmt_ts(secs):
    ms = int(round(float(secs) * 1000))
    minutes, millis = divmod(ms, 60000)
    seconds, millis = divmod(millis, 1000)
    return f'{minutes:02d}:{seconds:02d}.{millis:03d}'
m = whisper.load_model('${escapePythonLiteral(model)}')
audio = whisper.load_audio(r'${escapePythonLiteral(absPath)}')
audio = whisper.pad_or_trim(audio)
mel = whisper.log_mel_spectrogram(audio).to(m.device)
_, probs = m.detect_language(mel)
r = m.transcribe(r'${escapePythonLiteral(absPath)}'${langArg}${timestampArg})
lang = r.get('language')
if lang:
    confidence = probs.get(lang) if probs else None
    if confidence is not None:
        print('Detected language: ' + str(lang) + ' (confidence: ' + str(round(float(confidence), 2)) + ')')
    else:
        print('Detected language: ' + str(lang))
    print()
if ${timestamps ? 'True' : 'False'}:
    segments = r.get('segments') or []
    for seg in segments:
        text = (seg.get('text') or '').strip()
        if text:
            print('[' + fmt_ts(seg.get('start', 0)) + '] ' + text)
else:
    print((r.get('text') or '').strip())
" 2>&1`
}

function buildFasterWhisperCommand(absPath: string, model: string, language: string | undefined, timestamps: boolean): string {
  const langArg = language ? `, language='${escapePythonLiteral(language)}'` : ''
  return `python -c "
from faster_whisper import WhisperModel
def fmt_ts(secs):
    ms = int(round(float(secs) * 1000))
    minutes, millis = divmod(ms, 60000)
    seconds, millis = divmod(millis, 1000)
    return f'{minutes:02d}:{seconds:02d}.{millis:03d}'
model = WhisperModel('${escapePythonLiteral(model)}', device='cpu', compute_type='int8')
segments, info = model.transcribe(r'${escapePythonLiteral(absPath)}'${langArg}, word_timestamps=${timestamps ? 'True' : 'False'})
segments = list(segments)
lang = getattr(info, 'language', None)
confidence = getattr(info, 'language_probability', None)
if lang:
    if confidence is not None:
        print('Detected language: ' + str(lang) + ' (confidence: ' + str(round(float(confidence), 2)) + ')')
    else:
        print('Detected language: ' + str(lang))
    print()
if ${timestamps ? 'True' : 'False'}:
    for seg in segments:
        text = (seg.text or '').strip()
        if text:
            print('[' + fmt_ts(seg.start) + '] ' + text)
else:
    print(' '.join((seg.text or '').strip() for seg in segments).strip())
" 2>&1`
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
        timestamps: { type: 'string', description: 'When true, include per-segment timestamps in the transcript.' },
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

  const model = (args.model ?? 'small').trim() || 'small'
  const timestamps = (args.timestamps ?? '').trim().toLowerCase() === 'true'

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

  const command = impl === 'openai-whisper'
    ? buildOpenAiWhisperCommand(absPath, model, args.language, timestamps)
    : buildFasterWhisperCommand(absPath, model, args.language, timestamps)

  const result = await runTerminal({ command, max_output_chars: '120000' })
  const cleaned = cleanOutput(result)
  return cleaned || '(empty transcription)'
}

// ── whisper_status ────────────────────────────────────────────────────────────

export const whisperStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'whisper_status',
    description: 'Check whether Whisper and its Python dependencies are installed.',
    parameters: { type: 'object', properties: {} },
  },
}

export const whisperStatus: ToolHandler = async () => {
  const pythonVersionRaw = await runTerminal({ command: 'python --version 2>&1' })
  const pythonVersion = cleanOutput(pythonVersionRaw)
  if (/not recognized|No such file|cannot find/i.test(pythonVersion)) {
    return [
      `Python: ${pythonVersion || 'not found'}`,
      'Implementation: none',
      'Torch available: no',
      'Install instructions:',
      '  Install Python 3, then run either:',
      '  pip install openai-whisper',
      '  pip install faster-whisper',
    ].join('\n')
  }

  const impl = await detectWhisper()
  const torchRaw = await runTerminal({ command: 'python -c "import torch; print(torch.__version__)" 2>&1' })
  const torchClean = cleanOutput(torchRaw)
  const torchAvailable = !/No module named|Traceback|not recognized|No such file/i.test(torchClean)

  const lines = [
    `Python: ${pythonVersion}`,
    `Implementation: ${impl ?? 'none'}`,
    `Torch available: ${torchAvailable ? `yes (${torchClean})` : 'no'}`,
  ]

  if (!impl) {
    lines.push(
      'Install instructions:',
      '  pip install openai-whisper',
      '  pip install faster-whisper',
    )
  }

  return lines.join('\n')
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
