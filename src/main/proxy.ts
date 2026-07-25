import http from 'http'
import { streamChatRaw, chatOnce } from './ollama'
import { getSettings, baseUrl } from './store'

// Lokalny proxy tlumaczacy Anthropic Messages API <-> Ollama /api/chat.
// Dzieki temu narzedzia oczekujace API Anthropic (np. Claude Code) moga
// korzystac z lokalnej Ollamy. Obsluguje tekst, streaming (SSE) i tool-use.

let server: http.Server | null = null
let lastError: string | undefined

// ---- Konwersja wiadomosci Anthropic -> Ollama ----

function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
      .map((b) => b.text ?? '')
      .join('\n')
  }
  return ''
}

interface OllamaMsg {
  role: string
  content: string
  tool_calls?: unknown[]
}

function toOllamaMessages(system: unknown, messages: any[]): OllamaMsg[] {
  const out: OllamaMsg[] = []
  const sys = blocksToText(system)
  if (sys.trim()) out.push({ role: 'system', content: sys })

  for (const m of messages) {
    const content = m.content
    if (typeof content === 'string') {
      out.push({ role: m.role, content })
      continue
    }
    if (!Array.isArray(content)) continue

    // Bloki tool_result (rola user) -> wiadomosci roli 'tool'.
    const toolResults = content.filter((b: any) => b.type === 'tool_result')
    const toolUses = content.filter((b: any) => b.type === 'tool_use')
    const text = blocksToText(content)

    if (m.role === 'assistant' && toolUses.length) {
      out.push({
        role: 'assistant',
        content: text,
        tool_calls: toolUses.map((t: any) => ({
          function: { name: t.name, arguments: t.input ?? {} }
        }))
      })
    } else if (toolResults.length) {
      if (text.trim()) out.push({ role: 'user', content: text })
      for (const tr of toolResults) {
        out.push({ role: 'tool', content: blocksToText(tr.content) })
      }
    } else {
      out.push({ role: m.role, content: text })
    }
  }
  return out
}

function toOllamaTools(tools: any[] | undefined): unknown[] | undefined {
  if (!tools || !tools.length) return undefined
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema ?? { type: 'object', properties: {} }
    }
  }))
}

function pickModel(): string {
  const s = getSettings()
  return s.proxy.model || s.defaultModel
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

// ---- Obsluga zadan ----

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sseEvent(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

const msgId = (): string => 'msg_' + Math.random().toString(36).slice(2, 14)

async function handleMessages(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req)
  const model = pickModel()
  if (!model) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Brak modelu Ollamy w ustawieniach proxy.' } }))
    return
  }

  const messages = toOllamaMessages(body.system, body.messages ?? [])
  const tools = toOllamaTools(body.tools)
  const opts = getSettings().options
  const inputTokens = estimateTokens(JSON.stringify(body.messages ?? []) + blocksToText(body.system))

  // Streaming bez narzedzi -> strumieniujemy tokeny. W innym wypadku pobieramy calosc.
  const wantStream = !!body.stream

  if (wantStream && !tools) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    const id = msgId()
    sseEvent(res, 'message_start', {
      type: 'message_start',
      message: {
        id, type: 'message', role: 'assistant', model, content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 }
      }
    })
    sseEvent(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })

    let outText = ''
    try {
      await streamChatRaw({
        base: baseUrl(), model, messages, tools: undefined, options: opts,
        onChunk: (obj: any) => {
          const t = obj?.message?.content
          if (t) {
            outText += t
            sseEvent(res, 'content_block_delta', {
              type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t }
            })
          }
        }
      })
      sseEvent(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
      sseEvent(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: estimateTokens(outText) }
      })
      sseEvent(res, 'message_stop', { type: 'message_stop' })
    } catch (e) {
      sseEvent(res, 'error', { type: 'error', error: { type: 'api_error', message: (e as Error).message } })
    }
    res.end()
    return
  }

  // Sciezka bez streamingu (lub z narzedziami): jedno zapytanie do Ollamy.
  try {
    const result = await chatOnce({ base: baseUrl(), model, messages, tools, options: opts })
    const msg = result.message ?? {}
    const contentBlocks: any[] = []
    if (msg.content) contentBlocks.push({ type: 'text', text: msg.content })
    const toolCalls = msg.tool_calls ?? []
    for (const tc of toolCalls) {
      contentBlocks.push({
        type: 'tool_use',
        id: 'toolu_' + Math.random().toString(36).slice(2, 12),
        name: tc.function?.name,
        input: typeof tc.function?.arguments === 'string'
          ? safeJson(tc.function.arguments)
          : (tc.function?.arguments ?? {})
      })
    }
    if (contentBlocks.length === 0) contentBlocks.push({ type: 'text', text: '' })
    const stopReason = toolCalls.length ? 'tool_use' : 'end_turn'
    const id = msgId()
    const outText = msg.content ?? ''
    const anthropicMsg = {
      id, type: 'message', role: 'assistant', model,
      content: contentBlocks, stop_reason: stopReason, stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: estimateTokens(outText) }
    }

    if (!wantStream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(anthropicMsg))
      return
    }

    // Chce stream, ale byly narzedzia: emitujemy pelna sekwencje SSE naraz.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    sseEvent(res, 'message_start', {
      type: 'message_start',
      message: { ...anthropicMsg, content: [], stop_reason: null, usage: { input_tokens: inputTokens, output_tokens: 0 } }
    })
    contentBlocks.forEach((block, i) => {
      if (block.type === 'text') {
        sseEvent(res, 'content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } })
        sseEvent(res, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: block.text } })
      } else {
        sseEvent(res, 'content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } })
        sseEvent(res, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
      }
      sseEvent(res, 'content_block_stop', { type: 'content_block_stop', index: i })
    })
    sseEvent(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: estimateTokens(outText) } })
    sseEvent(res, 'message_stop', { type: 'message_stop' })
    res.end()
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: (e as Error).message } }))
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? ''

  if (req.method === 'POST' && url.startsWith('/v1/messages') && url.includes('count_tokens')) {
    readBody(req).then((body) => {
      const tokens = estimateTokens(JSON.stringify(body.messages ?? []) + blocksToText(body.system))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ input_tokens: tokens }))
    })
    return
  }

  if (req.method === 'POST' && url.startsWith('/v1/messages')) {
    handleMessages(req, res).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { message: (e as Error).message } }))
    })
    return
  }

  if (req.method === 'GET' && url.startsWith('/v1/models')) {
    const model = pickModel()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: model || 'ollama', type: 'model' }] }))
    return
  }

  if (url === '/' || url.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', proxy: 'anthropic->ollama' }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { message: 'Not found' } }))
}

export function startProxy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve()
      return
    }
    lastError = undefined
    const s = http.createServer(requestHandler)
    s.on('error', (e) => {
      lastError = (e as Error).message
      server = null
      reject(e)
    })
    s.listen(port, '127.0.0.1', () => {
      server = s
      resolve()
    })
  })
}

export function stopProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => {
      server = null
      resolve()
    })
  })
}

export function proxyStatus(port: number): { running: boolean; port: number; error?: string } {
  return { running: !!server, port, error: lastError }
}
