// Wspoldzielone typy uzywane przez main, preload i renderer.

export interface OllamaOptions {
  temperature: number
  top_p: number
  num_ctx: number
  keep_alive: string
  system: string
}

export interface RunnerPreset {
  id: string
  name: string
  /** Zmienna srodowiskowa, do ktorej wstawiamy URL bazowy Ollamy (np. OPENAI_BASE_URL). */
  baseUrlEnv: string
  /** Czy do baseUrl dokleic sufiks /v1 (OpenAI-compatible). */
  openaiCompat: boolean
  /** Zmienna na "klucz API" (Ollama go nie sprawdza, ale narzedzia wymagaja niepustego). */
  apiKeyEnv: string
  apiKeyValue: string
  /** Zmienna na nazwe modelu (opcjonalnie). */
  modelEnv: string
  /** Dodatkowe zmienne srodowiskowe. */
  extraEnv: Record<string, string>
  /** Polecenie do uruchomienia w nowym oknie terminala. */
  command: string
  /** Jesli true, jako baseUrl uzyj wbudowanego proxy Anthropic->Ollama zamiast Ollamy. */
  useProxy?: boolean
}

export interface ProxySettings {
  enabled: boolean
  port: number
  /** Model Ollamy, na ktory proxy mapuje kazde zadanie (Claude Code przysyla wlasne ID modelu). */
  model: string
}

export type Lang = 'pl' | 'en'

export interface RagSettings {
  enabled: boolean
  embedModel: string
  topK: number
}

export interface AppSettings {
  theme: 'light' | 'dark'
  lang: Lang
  host: string
  port: number
  defaultModel: string
  options: OllamaOptions
  runnerPresets: RunnerPreset[]
  proxy: ProxySettings
  libraries: Library[]
  rag: RagSettings
}

export interface RagStatus {
  chunks: number
  files: number
  indexedLibIds: string[]
}

export interface Conversation {
  id: string
  title: string
  model: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  workingDir?: string
}

export interface ProxyStatus {
  running: boolean
  port: number
  error?: string
}

export interface OllamaModel {
  name: string
  model: string
  size: number
  digest: string
  modified_at: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface CatalogModel {
  name: string
  description: string
  sizes: string[]
  category: string
}

export interface RagSource {
  file: string
  score?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Obrazy base64 (bez prefiksu data:) dla modeli multimodalnych. */
  images?: string[]
  /** Miniatury (data URL) do wyswietlenia w dymku i historii. */
  previews?: string[]
  /** Fragmenty RAG uzyte przy tej odpowiedzi (dla wiadomosci asystenta). */
  sources?: RagSource[]
}

export interface ContextResult {
  preamble: string
  sources: RagSource[]
}

export interface Attachment {
  name: string
  path: string
  kind: 'image' | 'text' | 'unsupported'
  size: number
  /** Dla text/pdf: wyekstrahowana zawartosc. */
  text?: string
  /** Dla image: base64 bez prefiksu. */
  base64?: string
  /** Typ MIME (dla obrazow). */
  mime?: string
  /** Miniatura data URL (generowana w rendererze). */
  preview?: string
}

export interface Library {
  id: string
  name: string
  path: string
  enabled: boolean
}

export interface ContextRequest {
  workingDir?: string
  includeListing?: boolean
  libraryIds?: string[]
  /** Zapytanie uzytkownika - uzywane do wyszukiwania RAG. */
  query?: string
}

export interface ChatRequest {
  id: string
  model: string
  messages: ChatMessage[]
}

export interface ChatChunk {
  id: string
  content: string
}

export interface PullProgress {
  id: string
  status: string
  completed?: number
  total?: number
  percent?: number
}

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
