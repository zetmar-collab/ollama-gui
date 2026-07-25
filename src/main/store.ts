import Store from 'electron-store'
import type { AppSettings, RunnerPreset, Conversation } from '../shared/types'

export const DEFAULT_PRESETS: RunnerPreset[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    baseUrlEnv: 'OPENAI_BASE_URL',
    openaiCompat: true,
    apiKeyEnv: 'OPENAI_API_KEY',
    apiKeyValue: 'ollama',
    modelEnv: 'OPENAI_MODEL',
    extraEnv: {},
    command: 'codex'
  },
  {
    id: 'aider',
    name: 'Aider',
    baseUrlEnv: 'OPENAI_API_BASE',
    openaiCompat: true,
    apiKeyEnv: 'OPENAI_API_KEY',
    apiKeyValue: 'ollama',
    modelEnv: '',
    extraEnv: {},
    command: 'aider --model openai/{model}'
  },
  {
    id: 'claude-code',
    name: 'Claude Code (przez proxy)',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    openaiCompat: false,
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    apiKeyValue: 'ollama',
    modelEnv: 'ANTHROPIC_MODEL',
    extraEnv: { ANTHROPIC_API_KEY: 'ollama' },
    command: 'claude',
    useProxy: true
  },
  {
    id: 'openai-generic',
    name: 'Wlasne narzedzie (OpenAI-compatible)',
    baseUrlEnv: 'OPENAI_BASE_URL',
    openaiCompat: true,
    apiKeyEnv: 'OPENAI_API_KEY',
    apiKeyValue: 'ollama',
    modelEnv: 'OPENAI_MODEL',
    extraEnv: {},
    command: 'cmd'
  }
]

const defaults: AppSettings = {
  theme: 'dark',
  lang: 'pl',
  host: '127.0.0.1',
  port: 11434,
  defaultModel: '',
  options: {
    temperature: 0.7,
    top_p: 0.9,
    num_ctx: 4096,
    keep_alive: '5m',
    system: ''
  },
  runnerPresets: DEFAULT_PRESETS,
  proxy: {
    enabled: false,
    port: 11435,
    model: ''
  },
  libraries: [],
  rag: {
    enabled: false,
    embedModel: 'nomic-embed-text',
    topK: 6
  }
}

const store = new Store<AppSettings>({ name: 'ollama-gui-settings', defaults })

export function getSettings(): AppSettings {
  return store.store
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...store.store, ...patch }
  store.store = next
  return next
}

export function baseUrl(): string {
  const s = store.store
  return `http://${s.host}:${s.port}`
}

export function proxyBaseUrl(): string {
  return `http://127.0.0.1:${store.store.proxy.port}`
}

// ---------- Historia rozmow ----------
interface ConvStore {
  conversations: Conversation[]
}
const convStore = new Store<ConvStore>({
  name: 'ollama-gui-conversations',
  defaults: { conversations: [] }
})

export function listConversations(): Conversation[] {
  return [...convStore.store.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveConversation(conv: Conversation): Conversation[] {
  const all = convStore.store.conversations
  const idx = all.findIndex((c) => c.id === conv.id)
  if (idx >= 0) all[idx] = conv
  else all.push(conv)
  convStore.set('conversations', all)
  return listConversations()
}

export function deleteConversation(id: string): Conversation[] {
  const all = convStore.store.conversations.filter((c) => c.id !== id)
  convStore.set('conversations', all)
  return listConversations()
}
