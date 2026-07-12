import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Check, ChevronDown, ChevronRight, Copy, Hash, Loader, Monitor, Play } from 'lucide-react'
import type { Components } from 'react-markdown'
import type { ComponentProps } from 'react'

const API_BASE: string = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')

type PreProps = ComponentProps<'pre'> & { node?: unknown }

const RENDERABLE = new Set(['html', 'htm', 'svg', 'css', 'javascript', 'js'])
const EXECUTABLE = new Set(['python', 'py', 'javascript', 'js', 'typescript', 'ts', 'bash', 'sh', 'powershell', 'ps1'])

function buildSrcDoc(lang: string, code: string): string {
  if (lang === 'html' || lang === 'htm') {
    return code.includes('<html') ? code
      : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:16px;line-height:1.6}</style></head><body>${code}</body></html>`
  }
  if (lang === 'svg') {
    return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa}</style></head><body>${code}</body></html>`
  }
  if (lang === 'css') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;padding:24px}${code}</style></head><body><h1>Heading 1</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p><button>Button</button><input type="text" placeholder="Input" /></body></html>`
  }
  if (lang === 'javascript' || lang === 'js') {
    return `<!DOCTYPE html><html><head><style>body{font-family:ui-monospace,monospace;padding:12px;background:#0d1117;color:#c9d1d9;margin:0;font-size:12px}pre{white-space:pre-wrap;margin:0}.err{color:#f85149}</style></head><body><pre id="out"></pre><script>const $o=document.getElementById('out');const $a=(t,c)=>$o.innerHTML+=(c?'<span style="color:'+c+'">':'<span>')+String(t).replace(/</g,'&lt;')+'</span>\n';['log','info'].forEach(k=>{const _=console[k];console[k]=(...a)=>{$a(a.map(String).join(' '));_(...a)}});['error','warn'].forEach(k=>{const _=console[k];console[k]=(...a)=>{$a(a.join(' '),'#f85149');_(...a)}});try{${code}}catch(e){$a('Uncaught: '+e.message,'#f85149')}<\/script></body></html>`
  }
  return code
}

function CodeBlock({ node: _node, children, ...rest }: PreProps) {
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState(false)
  const [running, setRunning] = useState(false)
  const [runOutput, setRunOutput] = useState<{ text: string; error: boolean } | null>(null)
  const [outputCopied, setOutputCopied] = useState(false)
  const [lineNums, setLineNums] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const codeEl = Array.isArray(children) ? children[0] : children
  const lang = (codeEl as { props?: { className?: string } })?.props?.className
    ?.match(/language-(\w+)/)?.[1] ?? ''

  const canPreview = RENDERABLE.has(lang)
  const canRun = EXECUTABLE.has(lang)

  function handleCopy() {
    const text = preRef.current?.textContent ?? ''
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleCopyOutput() {
    if (!runOutput) return
    void navigator.clipboard.writeText(runOutput.text).then(() => {
      setOutputCopied(true)
      setTimeout(() => setOutputCopied(false), 2000)
    })
  }

  async function handleRun() {
    const code = preRef.current?.textContent ?? ''
    if (!code.trim() || running) return
    setRunning(true)
    setRunOutput(null)
    try {
      const res = await fetch(`${API_BASE}/api/run-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, lang }),
      })
      const data = await res.json() as { output: string; error: boolean }
      setRunOutput({ text: data.output, error: data.error })
    } catch (e) {
      setRunOutput({ text: e instanceof Error ? e.message : 'Run failed', error: true })
    } finally {
      setRunning(false)
    }
  }

  const rawCode = preRef.current?.textContent ?? ''
  const lineCount = rawCode ? rawCode.split('\n').length : 0
  const srcDoc = preview ? buildSrcDoc(lang, rawCode) : ''

  return (
    <div className={`code-block-wrap ${lineNums ? 'with-line-nums' : ''}`}>
      <div className="code-block-toolbar">
        {lang && <span className="code-lang">{lang}</span>}
        {canRun && (
          <button type="button" className="run-btn" onClick={handleRun} disabled={running} title="Run this code">
            {running ? <Loader size={11} className="spin" /> : <Play size={11} />}
            <span>{running ? 'Runningâ€¦' : 'Run'}</span>
          </button>
        )}
        {canPreview && (
          <button type="button" className={`preview-btn ${preview ? 'active' : ''}`} onClick={() => setPreview(p => !p)} title={preview ? 'Hide preview' : 'Live preview'}>
            <Monitor size={11} />
            <span>{preview ? 'Hide' : 'Preview'}</span>
            {preview ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
        {lineCount > 3 && (
          <button type="button" className={`copy-btn ${lineNums ? 'active-lines' : ''}`} onClick={() => setLineNums(l => !l)} title="Toggle line numbers">
            <Hash size={11} />
          </button>
        )}
        <button type="button" className="copy-btn" onClick={handleCopy} aria-label="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Line number gutter + code */}
      <div className="code-body-wrap">
        {lineNums && lineCount > 1 && (
          <div className="code-line-gutter" aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
        )}
        <pre {...rest} ref={preRef} className={`${(rest as { className?: string }).className ?? ''} ${lineNums ? 'has-gutter' : ''}`}>
          {children}
        </pre>
      </div>

      {runOutput !== null && (
        <div className={`code-run-output ${runOutput.error ? 'error' : ''}`}>
          <div className="code-run-header">
            <span>{runOutput.error ? 'âœ— Error' : 'âœ“ Output'}</span>
            <button type="button" className="copy-btn" onClick={handleCopyOutput} title="Copy output">
              {outputCopied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            <button type="button" className="code-run-clear" onClick={() => setRunOutput(null)}>Ã—</button>
          </div>
          <pre className="code-run-pre">{runOutput.text}</pre>
        </div>
      )}
      {preview && (
        <div className="code-preview-pane">
          <div className="code-preview-header">
            <span>Live Preview</span>
            <a href={`data:text/html;charset=utf-8,${encodeURIComponent(srcDoc)}`} target="_blank" rel="noopener noreferrer" className="code-preview-open">â†— open</a>
          </div>
          <iframe key={srcDoc} sandbox="allow-scripts allow-same-origin" srcDoc={srcDoc} title="Code preview" className="code-preview-frame" />
        </div>
      )}
    </div>
  )
}

const mdComponents: Components = {
  pre: CodeBlock as Components['pre'],
}

export function MessageContent({ content, streaming, onImageClick }: {
  content: string
  streaming?: boolean
  onImageClick?: (url: string) => void
}) {
  // Intercept image clicks to open lightbox
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG' && onImageClick) {
      const src = (target as HTMLImageElement).src
      if (src) onImageClick(src)
    }
  }

  return (
    <div className="message-content" onClick={handleClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={mdComponents}
      >
        {content}
      </ReactMarkdown>
      {streaming && <span className="streaming-cursor" aria-hidden="true" />}
    </div>
  )
}
