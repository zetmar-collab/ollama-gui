import Store from 'electron-store'
import { promises as fs } from 'fs'
import path from 'path'
import type { Library, RagStatus, RagSource } from '../shared/types'
import { extractText, listTextFiles, MAX_TEXT_FILE } from './files'

// Prosty RAG: dzielimy pliki bibliotek na fragmenty, liczymy embeddingi przez
// Ollame (/api/embeddings) i przy zapytaniu zwracamy najbardziej podobne fragmenty.

interface Chunk {
  libId: string
  file: string
  text: string
  vector: number[]
}

interface FileMeta {
  mtimeMs: number
  size: number
}

interface RagIndex {
  chunks: Chunk[]
  // klucz: libId::filePath -> meta (do pomijania niezmienionych plikow)
  files: Record<string, FileMeta>
}

const store = new Store<RagIndex>({
  name: 'ollama-gui-rag-index',
  defaults: { chunks: [], files: {} }
})

const CHUNK_SIZE = 900
const CHUNK_OVERLAP = 120
const MAX_CHUNKS = 4000

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n')
  const chunks: string[] = []
  let i = 0
  while (i < clean.length) {
    const end = Math.min(i + CHUNK_SIZE, clean.length)
    const piece = clean.slice(i, end).trim()
    if (piece.length > 30) chunks.push(piece)
    if (end >= clean.length) break
    i = end - CHUNK_OVERLAP
  }
  return chunks
}

async function embed(base: string, model: string, text: string): Promise<number[]> {
  const res = await fetch(`${base}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text })
  })
  if (!res.ok) throw new Error(`Embeddings HTTP ${res.status} (czy model "${model}" jest pobrany?)`)
  const data = (await res.json()) as { embedding?: number[] }
  if (!data.embedding || !data.embedding.length) throw new Error('Pusty embedding z Ollamy.')
  return data.embedding
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function ragHasIndex(libIds: string[]): boolean {
  return store.store.chunks.some((c) => libIds.includes(c.libId))
}

export function ragStatus(): RagStatus {
  const idx = store.store
  const libs = new Set(idx.chunks.map((c) => c.libId))
  return { chunks: idx.chunks.length, files: Object.keys(idx.files).length, indexedLibIds: [...libs] }
}

export type ProgressFn = (p: { phase: string; done: number; total: number }) => void

// Buduje/aktualizuje indeks dla podanych bibliotek. Pomija niezmienione pliki.
export async function ragReindex(
  base: string,
  model: string,
  libs: Library[],
  onProgress: ProgressFn
): Promise<RagStatus> {
  const idx: RagIndex = { chunks: [...store.store.chunks], files: { ...store.store.files } }
  const activeLibIds = new Set(libs.map((l) => l.id))

  // Usun z indeksu biblioteki, ktorych juz nie ma / nie sa przetwarzane.
  idx.chunks = idx.chunks.filter((c) => activeLibIds.has(c.libId))
  for (const key of Object.keys(idx.files)) {
    if (!activeLibIds.has(key.split('::')[0])) delete idx.files[key]
  }

  // Zbierz liste plikow do przetworzenia.
  const jobs: { libId: string; file: string }[] = []
  for (const lib of libs) {
    let files: string[] = []
    try {
      const stat = await fs.stat(lib.path)
      files = stat.isDirectory() ? await listTextFiles(lib.path) : [lib.path]
    } catch {
      continue
    }
    for (const f of files) jobs.push({ libId: lib.id, file: f })
  }

  let done = 0
  for (const job of jobs) {
    done++
    onProgress({ phase: 'index', done, total: jobs.length })
    const key = `${job.libId}::${job.file}`
    let meta: FileMeta
    try {
      const stat = await fs.stat(job.file)
      if (stat.size > MAX_TEXT_FILE) continue
      meta = { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      continue
    }
    const prev = idx.files[key]
    if (prev && prev.mtimeMs === meta.mtimeMs && prev.size === meta.size) continue // bez zmian

    // Plik zmieniony/nowy: usun stare fragmenty i zaindeksuj ponownie.
    idx.chunks = idx.chunks.filter((c) => !(c.libId === job.libId && c.file === job.file))
    let text = ''
    try {
      text = await extractText(job.file)
    } catch {
      continue
    }
    const pieces = chunkText(text)
    for (const piece of pieces) {
      if (idx.chunks.length >= MAX_CHUNKS) break
      try {
        const vector = await embed(base, model, piece)
        idx.chunks.push({ libId: job.libId, file: job.file, text: piece, vector })
      } catch (e) {
        // Blad embeddingu (np. brak modelu) przerywa caly proces.
        throw e
      }
    }
    idx.files[key] = meta
    if (idx.chunks.length >= MAX_CHUNKS) break
  }

  store.store = idx
  return ragStatus()
}

export function ragClear(): void {
  store.store = { chunks: [], files: {} }
}

// Zwraca najbardziej podobne fragmenty: sklejony tekst + liste zrodel.
export async function ragRetrieve(
  base: string,
  model: string,
  libIds: string[],
  query: string,
  topK: number
): Promise<{ text: string; sources: RagSource[] }> {
  const pool = store.store.chunks.filter((c) => libIds.includes(c.libId))
  if (!pool.length) return { text: '', sources: [] }
  const qv = await embed(base, model, query)
  const scored = pool
    .map((c) => ({ c, score: cosine(qv, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK))
  const text = scored.map(({ c }) => `### ${path.basename(c.file)}\n${c.text}`).join('\n\n')
  const sources = scored.map(({ c, score }) => ({
    file: path.basename(c.file),
    score: Math.round(score * 1000) / 1000
  }))
  return { text, sources }
}
