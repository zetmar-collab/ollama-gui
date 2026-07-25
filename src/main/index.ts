import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import {
  getSettings,
  setSettings,
  baseUrl,
  proxyBaseUrl,
  listConversations,
  saveConversation,
  deleteConversation
} from './store'
import * as ollama from './ollama'
import { launchTool } from './runner'
import { startProxy, stopProxy, proxyStatus } from './proxy'
import {
  pickAttachments,
  readAttachments,
  pickDirectory,
  buildContext,
  exportConversation
} from './files'
import { ragReindex, ragStatus, ragClear } from './rag'
import { MODEL_CATALOG } from '../shared/catalog'
import type {
  AppSettings,
  ChatRequest,
  RunnerPreset,
  Conversation,
  ContextRequest
} from '../shared/types'

let mainWindow: BrowserWindow | null = null

// Aktywne strumienie (chat / pull), abysmy mogli je przerwac.
const chatControllers = new Map<string, AbortController>()
const pullControllers = new Map<string, AbortController>()

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Ollama GUI',
    icon: iconPath(),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

// ---------- IPC: ustawienia ----------
ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => setSettings(patch))

// ---------- IPC: Ollama ----------
ipcMain.handle('ollama:health', async () => {
  try {
    const version = await ollama.getVersion(baseUrl())
    return { ok: true, data: version }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('ollama:list', async () => {
  try {
    const data = await ollama.listModels(baseUrl())
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('ollama:delete', async (_e, name: string) => {
  try {
    await ollama.deleteModel(baseUrl(), name)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('catalog:list', () => MODEL_CATALOG)

// ---------- IPC: chat (streaming) ----------
ipcMain.handle('chat:start', async (_e, req: ChatRequest) => {
  const controller = new AbortController()
  chatControllers.set(req.id, controller)
  const settings = getSettings()
  try {
    await ollama.streamChat({
      base: baseUrl(),
      model: req.model,
      messages: req.messages,
      options: settings.options,
      signal: controller.signal,
      onToken: (t) => send('chat:chunk', { id: req.id, content: t })
    })
    send('chat:done', { id: req.id })
    return { ok: true }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      send('chat:done', { id: req.id })
      return { ok: true }
    }
    send('chat:error', { id: req.id, error: (e as Error).message })
    return { ok: false, error: (e as Error).message }
  } finally {
    chatControllers.delete(req.id)
  }
})

ipcMain.handle('chat:stop', (_e, id: string) => {
  chatControllers.get(id)?.abort()
  return { ok: true }
})

// ---------- IPC: pull (streaming) ----------
ipcMain.handle('pull:start', async (_e, payload: { id: string; name: string }) => {
  const controller = new AbortController()
  pullControllers.set(payload.id, controller)
  try {
    await ollama.pullModel({
      base: baseUrl(),
      name: payload.name,
      signal: controller.signal,
      onProgress: (p) => {
        const percent = p.total && p.completed ? Math.round((p.completed / p.total) * 100) : undefined
        send('pull:progress', { id: payload.id, ...p, percent })
      }
    })
    send('pull:done', { id: payload.id })
    return { ok: true }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      send('pull:done', { id: payload.id })
      return { ok: true }
    }
    send('pull:error', { id: payload.id, error: (e as Error).message })
    return { ok: false, error: (e as Error).message }
  } finally {
    pullControllers.delete(payload.id)
  }
})

ipcMain.handle('pull:stop', (_e, id: string) => {
  pullControllers.get(id)?.abort()
  return { ok: true }
})

// ---------- IPC: runner ----------
ipcMain.handle('runner:launch', (_e, payload: { preset: RunnerPreset; model: string }) => {
  try {
    const res = launchTool({
      preset: payload.preset,
      base: baseUrl(),
      proxyBase: proxyBaseUrl(),
      model: payload.model
    })
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ---------- IPC: proxy Anthropic->Ollama ----------
ipcMain.handle('proxy:start', async () => {
  const port = getSettings().proxy.port
  try {
    await startProxy(port)
    setSettings({ proxy: { ...getSettings().proxy, enabled: true } })
    return { ok: true, data: proxyStatus(port) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('proxy:stop', async () => {
  await stopProxy()
  setSettings({ proxy: { ...getSettings().proxy, enabled: false } })
  return { ok: true, data: proxyStatus(getSettings().proxy.port) }
})

ipcMain.handle('proxy:status', () => proxyStatus(getSettings().proxy.port))

// ---------- IPC: historia rozmow ----------
ipcMain.handle('conv:list', () => listConversations())
ipcMain.handle('conv:save', (_e, conv: Conversation) => saveConversation(conv))
ipcMain.handle('conv:delete', (_e, id: string) => deleteConversation(id))

// ---------- IPC: pliki / katalog / kontekst ----------
ipcMain.handle('files:pick', () => pickAttachments(mainWindow))
ipcMain.handle('files:read', (_e, paths: string[]) => readAttachments(paths))
ipcMain.handle('dir:pick', () => pickDirectory(mainWindow))
ipcMain.handle('conv:export', async (_e, conv: Conversation) => {
  try {
    const r = await exportConversation(mainWindow, conv)
    return { ok: true, data: r }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
ipcMain.handle('context:build', async (_e, req: ContextRequest) => {
  try {
    const preamble = await buildContext(req, getSettings(), baseUrl())
    return { ok: true, data: preamble }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ---------- IPC: RAG ----------
ipcMain.handle('rag:reindex', async () => {
  const s = getSettings()
  const libs = s.libraries.filter((l) => l.enabled)
  try {
    const status = await ragReindex(baseUrl(), s.rag.embedModel, libs, (p) =>
      send('rag:progress', p)
    )
    return { ok: true, data: status }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('rag:status', () => ragStatus())
ipcMain.handle('rag:clear', () => {
  ragClear()
  return ragStatus()
})

// ---------- lifecycle ----------
app.whenReady().then(() => {
  createWindow()
  // Autostart proxy, jesli byl wlaczony.
  const proxy = getSettings().proxy
  if (proxy.enabled) {
    startProxy(proxy.port).catch(() => {
      /* status pokaze blad w UI */
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopProxy().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})
