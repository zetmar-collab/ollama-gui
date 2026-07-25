import type { OllamaModel, OllamaOptions } from '../shared/types'

// Klient REST API Ollamy. Node 24 ma wbudowane fetch + ReadableStream.

export async function getVersion(base: string): Promise<string> {
  const res = await fetch(`${base}/api/version`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { version: string }
  return data.version
}

export async function listModels(base: string): Promise<OllamaModel[]> {
  const res = await fetch(`${base}/api/tags`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { models: OllamaModel[] }
  return data.models ?? []
}

export async function deleteModel(base: string, name: string): Promise<void> {
  const res = await fetch(`${base}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export interface ChatOptions {
  base: string
  model: string
  messages: { role: string; content: string; images?: string[] }[]
  options: OllamaOptions
  signal: AbortSignal
  onToken: (t: string) => void
}

export async function streamChat(opts: ChatOptions): Promise<void> {
  const body = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    keep_alive: opts.options.keep_alive,
    options: {
      temperature: opts.options.temperature,
      top_p: opts.options.top_p,
      num_ctx: opts.options.num_ctx
    }
  }
  const res = await fetch(`${opts.base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await consumeNdjson(res.body, (obj) => {
    const msg = obj as { message?: { content?: string }; done?: boolean }
    if (msg.message?.content) opts.onToken(msg.message.content)
  })
}

// --- Warianty uzywane przez proxy (obsluga narzedzi i surowych chunkow) ---

export interface RawChatOptions {
  base: string
  model: string
  messages: unknown[]
  tools?: unknown[]
  options: OllamaOptions
}

export async function streamChatRaw(
  opts: RawChatOptions & { onChunk: (obj: unknown) => void }
): Promise<void> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    keep_alive: opts.options.keep_alive,
    options: {
      temperature: opts.options.temperature,
      top_p: opts.options.top_p,
      num_ctx: opts.options.num_ctx
    }
  }
  if (opts.tools) body.tools = opts.tools
  const res = await fetch(`${opts.base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await consumeNdjson(res.body, opts.onChunk)
}

export interface ChatOnceResult {
  message?: { content?: string; tool_calls?: any[] }
}

export async function chatOnce(opts: RawChatOptions): Promise<ChatOnceResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
    keep_alive: opts.options.keep_alive,
    options: {
      temperature: opts.options.temperature,
      top_p: opts.options.top_p,
      num_ctx: opts.options.num_ctx
    }
  }
  if (opts.tools) body.tools = opts.tools
  const res = await fetch(`${opts.base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as ChatOnceResult
}

export interface PullOptions {
  base: string
  name: string
  signal: AbortSignal
  onProgress: (p: { status: string; completed?: number; total?: number }) => void
}

export async function pullModel(opts: PullOptions): Promise<void> {
  const res = await fetch(`${opts.base}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: opts.name, stream: true }),
    signal: opts.signal
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await consumeNdjson(res.body, (obj) => {
    const p = obj as { status?: string; completed?: number; total?: number; error?: string }
    if (p.error) throw new Error(p.error)
    opts.onProgress({ status: p.status ?? '', completed: p.completed, total: p.total })
  })
}

// Parsuje strumien NDJSON (jeden obiekt JSON na linie).
async function consumeNdjson(
  body: ReadableStream<Uint8Array>,
  onObject: (obj: unknown) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line) onObject(JSON.parse(line))
    }
  }
  const rest = buffer.trim()
  if (rest) onObject(JSON.parse(rest))
}
