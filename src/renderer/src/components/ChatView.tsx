import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  Attachment,
  ChatMessage,
  Conversation,
  OllamaModel,
  RagSource
} from '../../../shared/types'
import { makeT } from '../i18n'

interface Props {
  settings: AppSettings
  models: OllamaModel[]
  online: boolean
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  showToast: (msg: string, err?: boolean) => void
}

let counter = 0
const newId = (): string => `chat-${Date.now()}-${counter++}`
const convIdGen = (): string => `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const baseName = (p: string): string => p.replace(/\\/g, '/').split('/').pop() || p

// Tworzy zmniejszona miniature (data URL) z pelnego obrazu.
function makeThumb(dataUrl: string, max = 240): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export default function ChatView({
  settings,
  models,
  online,
  updateSettings,
  showToast
}: Props): JSX.Element {
  const [model, setModel] = useState(settings.defaultModel || '')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [workingDir, setWorkingDir] = useState<string | null>(null)
  const [includeListing, setIncludeListing] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [search, setSearch] = useState('')

  const activeId = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const currentIdRef = useRef<string | null>(null)
  const workingDirRef = useRef<string | null>(null)
  messagesRef.current = messages
  currentIdRef.current = currentId
  workingDirRef.current = workingDir

  const enabledLibs = settings.libraries.filter((l) => l.enabled)
  const t = makeT(settings.lang)

  useEffect(() => {
    if (!model && models.length) setModel(settings.defaultModel || models[0].name)
  }, [models])

  const loadList = (): void => {
    window.api.listConversations().then(setConversations)
  }
  useEffect(loadList, [])

  const persist = (): void => {
    const msgs = messagesRef.current.filter((m) => m.role !== 'system')
    if (msgs.length === 0) return
    // Zapisujemy tresc + miniatury + zrodla (bez pelnego base64 wysylanego do modelu).
    const slim = msgs.map((m) => ({
      role: m.role,
      content: m.content,
      previews: m.previews,
      sources: m.sources
    }))
    const id = currentIdRef.current ?? convIdGen()
    if (!currentIdRef.current) {
      setCurrentId(id)
      currentIdRef.current = id
    }
    const firstUser = msgs.find((m) => m.role === 'user')
    const title = (firstUser?.content ?? 'Rozmowa').slice(0, 48)
    const existing = conversations.find((c) => c.id === id)
    const conv: Conversation = {
      id,
      title,
      model,
      messages: slim,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      workingDir: workingDirRef.current ?? undefined
    }
    window.api.saveConversation(conv).then(setConversations)
  }

  useEffect(() => {
    const offChunk = window.api.onChatChunk((p) => {
      if (p.id !== activeId.current) return
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') last.content += p.content
        return copy
      })
    })
    const offDone = window.api.onChatDone((p) => {
      if (p.id !== activeId.current) return
      setStreaming(false)
      activeId.current = null
      persist()
    })
    const offErr = window.api.onChatError((p) => {
      if (p.id !== activeId.current) return
      showToast(t('chat.error') + p.error, true)
      setStreaming(false)
      activeId.current = null
    })
    return () => {
      offChunk()
      offDone()
      offErr()
    }
  }, [showToast, conversations, model])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const newChat = (): void => {
    setMessages([])
    setCurrentId(null)
    currentIdRef.current = null
    setAttachments([])
    setWorkingDir(null)
  }

  const loadChat = (c: Conversation): void => {
    setMessages(c.messages)
    setCurrentId(c.id)
    currentIdRef.current = c.id
    setWorkingDir(c.workingDir ?? null)
    setAttachments([])
    if (c.model) setModel(c.model)
  }

  const removeChat = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    const next = await window.api.deleteConversation(id)
    setConversations(next)
    if (currentIdRef.current === id) newChat()
  }

  // --- Zalaczniki ---
  const ingest = async (picked: Attachment[]): Promise<void> => {
    if (!picked.length) return
    const unsupported = picked.filter((a) => a.kind === 'unsupported')
    if (unsupported.length) {
      showToast(t('chat.skipUnsupported') + unsupported.map((a) => a.name).join(', '), true)
    }
    const supported = picked.filter((a) => a.kind !== 'unsupported')
    for (const a of supported) {
      if (a.kind === 'image' && a.base64) {
        const full = `data:${a.mime ?? 'image/png'};base64,${a.base64}`
        a.preview = await makeThumb(full)
      }
    }
    setAttachments((prev) => [...prev, ...supported])
  }
  const addFiles = async (): Promise<void> => {
    await ingest(await window.api.pickFiles())
  }
  const removeAttachment = (i: number): void => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i))
  }

  // --- Drag & drop ---
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
    if (!paths.length) return
    await ingest(await window.api.readFiles(paths))
  }

  // --- Eksport rozmowy ---
  const exportChat = async (): Promise<void> => {
    const msgs = messagesRef.current.filter((m) => m.role !== 'system')
    if (msgs.length === 0) {
      showToast(t('chat.nothingToExport'), true)
      return
    }
    const firstUser = msgs.find((m) => m.role === 'user')
    const conv: Conversation = {
      id: currentIdRef.current ?? convIdGen(),
      title: (firstUser?.content ?? 'Rozmowa').slice(0, 48),
      model,
      messages: msgs.map((m) => ({ role: m.role, content: m.content, sources: m.sources })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDir: workingDirRef.current ?? undefined
    }
    const res = await window.api.exportConversation(conv)
    if (res.ok && res.data?.saved) showToast(t('chat.exported') + res.data.path)
    else if (!res.ok) showToast(t('chat.exportFail') + res.error, true)
  }

  // --- Katalog roboczy ---
  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.pickDirectory()
    if (dir) setWorkingDir(dir)
  }

  // --- Biblioteki ---
  const toggleLibrary = (id: string): void => {
    updateSettings({
      libraries: settings.libraries.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l))
    })
  }

  const send = async (): Promise<void> => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || streaming) return
    if (!model) {
      showToast(t('chat.selectModel'), true)
      return
    }

    const imgs = attachments.filter((a) => a.kind === 'image' && a.base64)
    const txts = attachments.filter((a) => a.kind === 'text' && a.text)
    const previews = imgs.map((a) => a.preview).filter((p): p is string => !!p)

    // Tresc wyswietlana (bez base64) + notki o zalacznikach tekstowych.
    const noteFiles = txts.map((a) => `📎 ${a.name}`)
    const displayContent = [text, ...(noteFiles.length ? ['', ...noteFiles] : [])].join('\n').trim()

    // Kontekst: katalog roboczy + biblioteki.
    let preamble = ''
    let sources: RagSource[] = []
    if (workingDir || enabledLibs.length) {
      const ctx = await window.api.buildContext({
        workingDir: workingDir ?? undefined,
        includeListing,
        libraryIds: enabledLibs.map((l) => l.id),
        query: text
      })
      if (ctx.ok && ctx.data) {
        preamble = ctx.data.preamble
        sources = ctx.data.sources
      }
    }

    // Budujemy wiadomosci do API.
    const apiMessages: ChatMessage[] = []
    const sysParts = [settings.options.system.trim(), preamble.trim()].filter(Boolean)
    if (sysParts.length) apiMessages.push({ role: 'system', content: sysParts.join('\n\n---\n\n') })
    for (const m of messagesRef.current) {
      if (m.role === 'system') continue
      apiMessages.push({ role: m.role, content: m.content })
    }
    const fileBlocks = txts
      .map((a) => `${t('chat.attachedFile')} "${a.name}":\n\`\`\`\n${a.text}\n\`\`\``)
      .join('\n\n')
    const userApiContent = [fileBlocks, text].filter(Boolean).join('\n\n')
    apiMessages.push({
      role: 'user',
      content: userApiContent || t('chat.seeImages'),
      images: imgs.length ? imgs.map((a) => a.base64!) : undefined
    })

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: displayContent, previews: previews.length ? previews : undefined },
      { role: 'assistant', content: '', sources: sources.length ? sources : undefined }
    ])
    setInput('')
    setAttachments([])
    setStreaming(true)

    const id = newId()
    activeId.current = id
    const res = await window.api.startChat({ id, model, messages: apiMessages })
    if (!res.ok) {
      showToast(t('chat.sendFail') + res.error, true)
      setStreaming(false)
      activeId.current = null
    }
  }

  const stop = (): void => {
    if (activeId.current) window.api.stopChat(activeId.current)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Skroty klawiszowe czatu.
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault()
          newChat()
        } else if (e.key.toLowerCase() === 'f') {
          e.preventDefault()
          searchRef.current?.focus()
        } else if (e.key.toLowerCase() === 'e') {
          e.preventDefault()
          exportChat()
        }
      } else if (e.key === 'Escape') {
        if (activeId.current) stop()
        else if (search) setSearch('')
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [search, model, streaming, conversations])

  // Filtrowanie rozmow (po tytule i tresci wiadomosci).
  const q = search.trim().toLowerCase()
  const filteredConvs = q
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => m.content.toLowerCase().includes(q))
      )
    : conversations

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div className="conv-list">
        <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={newChat}>
          {t('chat.newConv')}
        </button>
        <input
          ref={searchRef}
          className="conv-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('chat.searchPlaceholder')}
        />
        {conversations.length === 0 && <div className="hint">{t('chat.noConv')}</div>}
        {conversations.length > 0 && filteredConvs.length === 0 && (
          <div className="hint">{t('chat.noResults')}</div>
        )}
        {filteredConvs.map((c) => (
          <div
            key={c.id}
            className={`conv-item ${currentId === c.id ? 'active' : ''}`}
            onClick={() => loadChat(c)}
          >
            <span className="conv-title">{c.title}</span>
            <span className="conv-del" onClick={(e) => removeChat(e, c.id)} title={t('chat.delete')}>
              ✕
            </span>
          </div>
        ))}
      </div>

      <div
        className="chat-wrap"
        onDragOver={(e) => {
          e.preventDefault()
          if (!dragOver) setDragOver(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false)
        }}
        onDrop={onDrop}
      >
        <div className="topbar">
          <h2>{t('nav.chat')}</h2>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.length === 0 && <option value="">{t('chat.noModels')}</option>}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <button onClick={exportChat} disabled={messages.length === 0} title={t('chat.export')}>
            ⬇ {t('chat.export')}
          </button>
        </div>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <div className="big">🦙</div>
              <div>{t('chat.emptyTitle')}</div>
              {!online && (
                <div style={{ marginTop: 8, color: 'var(--danger)' }}>{t('chat.offlineWarn')}</div>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="role">{m.role === 'user' ? t('chat.you') : t('chat.assistant')}</div>
              {m.previews && m.previews.length > 0 && (
                <div className="msg-imgs">
                  {m.previews.map((src, k) => (
                    <img key={k} src={src} className="msg-img" alt="" />
                  ))}
                </div>
              )}
              {m.content || (streaming && i === messages.length - 1 ? '▍' : '')}
              {m.sources && m.sources.length > 0 && (
                <details className="rag-sources">
                  <summary>
                    📚 {t('chat.ragSources')} ({m.sources.length})
                  </summary>
                  <div className="rag-list">
                    {m.sources.map((s, k) => (
                      <span key={k} className="rag-src">
                        {s.file}
                        {typeof s.score === 'number' ? ` · ${s.score}` : ''}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>

        {dragOver && (
          <div className="drop-overlay" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
            <div>📎 {t('chat.dropHere')}</div>
          </div>
        )}

        {/* Pasek kontekstu: katalog roboczy + biblioteki */}
        <div className="ctx-bar">
          {workingDir ? (
            <span className="ctx-chip active" title={workingDir}>
              📁 {baseName(workingDir)}
              <label className="ctx-listing" title={t('chat.structureTitle')}>
                <input
                  type="checkbox"
                  checked={includeListing}
                  onChange={(e) => setIncludeListing(e.target.checked)}
                />
                {t('chat.structure')}
              </label>
              <span className="ctx-x" onClick={() => setWorkingDir(null)}>
                ✕
              </span>
            </span>
          ) : (
            <button className="ctx-btn" onClick={chooseDir}>
              📁 {t('chat.workingDir')}
            </button>
          )}

          {settings.libraries.length > 0 && <span className="ctx-sep">📚</span>}
          {settings.libraries.map((l) => (
            <span
              key={l.id}
              className={`ctx-chip ${l.enabled ? 'active' : ''}`}
              onClick={() => toggleLibrary(l.id)}
              title={l.path}
            >
              {l.enabled ? '✓ ' : ''}
              {l.name}
            </span>
          ))}
        </div>

        {/* Zalaczniki */}
        {attachments.length > 0 && (
          <div className="attach-bar">
            {attachments.map((a, i) => (
              <span key={i} className="attach-chip">
                {a.kind === 'image' && a.preview ? (
                  <img src={a.preview} className="attach-thumb" alt="" />
                ) : (
                  '📎'
                )}{' '}
                {a.name}
                <span className="ctx-x" onClick={() => removeAttachment(i)}>
                  ✕
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="composer">
          <button className="icon-btn" onClick={addFiles} title={t('chat.addFile')}>
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('chat.placeholder')}
            rows={1}
          />
          {streaming ? (
            <button className="danger" onClick={stop}>
              {t('chat.stop')}
            </button>
          ) : (
            <button
              className="primary"
              onClick={send}
              disabled={!online || (!input.trim() && attachments.length === 0)}
            >
              {t('chat.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
