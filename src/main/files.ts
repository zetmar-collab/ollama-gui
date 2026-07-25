import { dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  Attachment,
  ContextRequest,
  Library,
  AppSettings,
  ContextResult,
  RagSource,
  Conversation
} from '../shared/types'
import { ragRetrieve, ragHasIndex } from './rag'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse/lib/pdf-parse.js')

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.yaml', '.yml', '.csv', '.tsv',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.php', '.html', '.css', '.scss', '.sql', '.sh', '.bat',
  '.ps1', '.xml', '.ini', '.toml', '.env', '.log', '.vue', '.svelte', '.kt', '.swift'
])
const PDF_EXT = new Set(['.pdf'])
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', '.cache', 'build', '__pycache__', '.venv', 'venv'])

export const MAX_TEXT_FILE = 2 * 1024 * 1024 // 2 MB na plik
const MAX_LIBRARY_CHARS = 60 * 1024 // limit calego kontekstu biblioteki (tryb bez RAG)
const MAX_LISTING_ENTRIES = 400

export function kindOf(file: string): 'image' | 'text' | 'unsupported' {
  const ext = path.extname(file).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (TEXT_EXT.has(ext) || PDF_EXT.has(ext)) return 'text'
  return 'unsupported'
}

// Ekstrahuje tekst z pliku (PDF przez pdf-parse, reszta jako utf8).
export async function extractText(fullPath: string): Promise<string> {
  const ext = path.extname(fullPath).toLowerCase()
  if (PDF_EXT.has(ext)) {
    const buf = await fs.readFile(fullPath)
    const data = await pdfParse(buf)
    return data.text
  }
  return fs.readFile(fullPath, 'utf8')
}

// Lista plikow tekstowych/pdf w folderze (rekurencyjnie, z pominieciami).
export async function listTextFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(full)
      } else if (kindOf(e.name) === 'text') {
        out.push(full)
      }
    }
  }
  return out
}

// Wczytuje pojedynczy zalacznik (obraz -> base64, tekst/pdf -> tekst).
export async function readAttachment(p: string): Promise<Attachment> {
  const stat = await fs.stat(p)
  const kind = kindOf(p)
  const ext = path.extname(p).toLowerCase()
  const att: Attachment = { name: path.basename(p), path: p, kind, size: stat.size }
  try {
    if (kind === 'image') {
      const data = await fs.readFile(p)
      att.base64 = data.toString('base64')
      att.mime = MIME[ext] ?? 'image/png'
    } else if (kind === 'text' && stat.size <= MAX_TEXT_FILE) {
      att.text = await extractText(p)
    }
  } catch {
    att.kind = 'unsupported'
  }
  return att
}

export async function readAttachments(paths: string[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const p of paths) {
    try {
      out.push(await readAttachment(p))
    } catch {
      /* pomijamy niedostepne */
    }
  }
  return out
}

export async function pickAttachments(win: BrowserWindow | null): Promise<Attachment[]> {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Wybierz pliki lub zdjęcia',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Obrazy, dokumenty, PDF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'json', 'csv', 'js', 'ts', 'py', 'pdf'] },
      { name: 'Wszystkie pliki', extensions: ['*'] }
    ]
  })
  if (res.canceled) return []
  return readAttachments(res.filePaths)
}

// Eksportuje rozmowe do pliku Markdown (lub JSON).
export async function exportConversation(
  win: BrowserWindow | null,
  conv: Conversation
): Promise<{ saved: boolean; path?: string }> {
  const safeTitle = (conv.title || 'rozmowa').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  const res = await dialog.showSaveDialog(win!, {
    title: 'Eksportuj rozmowę',
    defaultPath: `${safeTitle}.md`,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (res.canceled || !res.filePath) return { saved: false }

  const isJson = res.filePath.toLowerCase().endsWith('.json')
  let content: string
  if (isJson) {
    content = JSON.stringify(conv, null, 2)
  } else {
    const date = new Date(conv.updatedAt).toLocaleString()
    const lines = [`# ${conv.title}`, '', `- Model: ${conv.model}`, `- Data: ${date}`, '']
    for (const m of conv.messages) {
      if (m.role === 'system') continue
      lines.push(`## ${m.role === 'user' ? 'Ty' : 'Asystent'}`, '', m.content, '')
      if (m.sources && m.sources.length) {
        lines.push('_Źródła (RAG): ' + m.sources.map((s) => s.file).join(', ') + '_', '')
      }
    }
    content = lines.join('\n')
  }
  await fs.writeFile(res.filePath, content, 'utf8')
  return { saved: true, path: res.filePath }
}

export async function pickDirectory(win: BrowserWindow | null): Promise<string | null> {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Wybierz katalog',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
}

async function listDirTree(dir: string): Promise<string> {
  const lines: string[] = []
  let count = 0
  async function walk(current: string, prefix: string, depth: number): Promise<void> {
    if (count >= MAX_LISTING_ENTRIES || depth > 4) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const e of entries) {
      if (count >= MAX_LISTING_ENTRIES) break
      if (e.name.startsWith('.') && e.name !== '.env') continue
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) {
        lines.push(`${prefix}${e.name}/ (pominięto)`)
        count++
        continue
      }
      lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`)
      count++
      if (e.isDirectory()) await walk(path.join(current, e.name), prefix + '  ', depth + 1)
    }
  }
  await walk(dir, '', 0)
  if (count >= MAX_LISTING_ENTRIES) lines.push('... (lista skrócona)')
  return lines.join('\n')
}

// Pelny zrzut bibliotek do kontekstu (tryb bez RAG).
async function dumpLibraries(libs: Library[]): Promise<string> {
  const parts: string[] = []
  let total = 0
  for (const lib of libs) {
    if (total >= MAX_LIBRARY_CHARS) break
    let files: string[] = []
    try {
      const stat = await fs.stat(lib.path)
      files = stat.isDirectory() ? await listTextFiles(lib.path) : [lib.path]
    } catch {
      continue
    }
    for (const f of files) {
      if (total >= MAX_LIBRARY_CHARS) break
      try {
        const stat = await fs.stat(f)
        if (stat.size > MAX_TEXT_FILE) continue
        const content = await extractText(f)
        const rel = path.relative(lib.path, f) || path.basename(f)
        const remaining = MAX_LIBRARY_CHARS - total
        const snippet = content.slice(0, remaining)
        parts.push(`### [${lib.name}] ${rel}\n${snippet}`)
        total += snippet.length
      } catch {
        /* pomijamy nieczytelne pliki */
      }
    }
  }
  return parts.join('\n\n')
}

// Buduje preambule kontekstu (katalog roboczy + biblioteki, z RAG lub bez).
export async function buildContext(
  req: ContextRequest,
  settings: AppSettings,
  base: string
): Promise<ContextResult> {
  const blocks: string[] = []
  let sources: RagSource[] = []

  if (req.workingDir && req.includeListing) {
    const tree = await listDirTree(req.workingDir)
    blocks.push(`Pracujesz w katalogu roboczym: ${req.workingDir}\nStruktura plików:\n${tree}`)
  }

  const enabled = settings.libraries.filter((l) => (req.libraryIds ?? []).includes(l.id))
  if (enabled.length) {
    let libText = ''
    // RAG: jesli wlaczony, jest indeks i mamy zapytanie -> wyszukiwanie semantyczne.
    if (settings.rag.enabled && req.query && ragHasIndex(enabled.map((l) => l.id))) {
      try {
        const r = await ragRetrieve(
          base,
          settings.rag.embedModel,
          enabled.map((l) => l.id),
          req.query,
          settings.rag.topK
        )
        libText = r.text
        sources = r.sources
      } catch {
        libText = ''
      }
    }
    // Fallback: pelny zrzut (gdy RAG wylaczony lub brak wynikow).
    if (!libText.trim()) libText = await dumpLibraries(enabled)

    if (libText.trim()) {
      blocks.push(
        `Poniżej materiały referencyjne z bibliotek użytkownika. Korzystaj z nich, odpowiadając:\n\n${libText}`
      )
    }
  }

  return { preamble: blocks.join('\n\n---\n\n'), sources }
}
