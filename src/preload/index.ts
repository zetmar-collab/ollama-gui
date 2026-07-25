import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  ChatRequest,
  OllamaModel,
  CatalogModel,
  RunnerPreset,
  IpcResult,
  Conversation,
  ProxyStatus,
  Attachment,
  ContextRequest,
  ContextResult,
  RagStatus
} from '../shared/types'

function on(channel: string, cb: (payload: any) => void): () => void {
  const listener = (_e: unknown, payload: any): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // ustawienia
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),

  // ollama
  health: (): Promise<IpcResult<string>> => ipcRenderer.invoke('ollama:health'),
  listModels: (): Promise<IpcResult<OllamaModel[]>> => ipcRenderer.invoke('ollama:list'),
  deleteModel: (name: string): Promise<IpcResult> => ipcRenderer.invoke('ollama:delete', name),
  catalog: (): Promise<CatalogModel[]> => ipcRenderer.invoke('catalog:list'),

  // chat
  startChat: (req: ChatRequest): Promise<IpcResult> => ipcRenderer.invoke('chat:start', req),
  stopChat: (id: string): Promise<IpcResult> => ipcRenderer.invoke('chat:stop', id),
  onChatChunk: (cb: (p: { id: string; content: string }) => void) => on('chat:chunk', cb),
  onChatDone: (cb: (p: { id: string }) => void) => on('chat:done', cb),
  onChatError: (cb: (p: { id: string; error: string }) => void) => on('chat:error', cb),

  // pull
  startPull: (id: string, name: string): Promise<IpcResult> =>
    ipcRenderer.invoke('pull:start', { id, name }),
  stopPull: (id: string): Promise<IpcResult> => ipcRenderer.invoke('pull:stop', id),
  onPullProgress: (
    cb: (p: { id: string; status: string; percent?: number; completed?: number; total?: number }) => void
  ) => on('pull:progress', cb),
  onPullDone: (cb: (p: { id: string }) => void) => on('pull:done', cb),
  onPullError: (cb: (p: { id: string; error: string }) => void) => on('pull:error', cb),

  // runner
  launchRunner: (preset: RunnerPreset, model: string): Promise<IpcResult<{ command: string }>> =>
    ipcRenderer.invoke('runner:launch', { preset, model }),

  // proxy Anthropic->Ollama
  proxyStart: (): Promise<IpcResult<ProxyStatus>> => ipcRenderer.invoke('proxy:start'),
  proxyStop: (): Promise<IpcResult<ProxyStatus>> => ipcRenderer.invoke('proxy:stop'),
  proxyStatus: (): Promise<ProxyStatus> => ipcRenderer.invoke('proxy:status'),

  // historia rozmow
  listConversations: (): Promise<Conversation[]> => ipcRenderer.invoke('conv:list'),
  saveConversation: (conv: Conversation): Promise<Conversation[]> =>
    ipcRenderer.invoke('conv:save', conv),
  deleteConversation: (id: string): Promise<Conversation[]> =>
    ipcRenderer.invoke('conv:delete', id),

  // pliki / katalog / kontekst
  pickFiles: (): Promise<Attachment[]> => ipcRenderer.invoke('files:pick'),
  readFiles: (paths: string[]): Promise<Attachment[]> => ipcRenderer.invoke('files:read', paths),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dir:pick'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPathForFile: (file: unknown): string => webUtils.getPathForFile(file as any),
  exportConversation: (conv: Conversation): Promise<IpcResult<{ saved: boolean; path?: string }>> =>
    ipcRenderer.invoke('conv:export', conv),
  buildContext: (req: ContextRequest): Promise<IpcResult<ContextResult>> =>
    ipcRenderer.invoke('context:build', req),

  // RAG
  ragReindex: (): Promise<IpcResult<RagStatus>> => ipcRenderer.invoke('rag:reindex'),
  ragStatus: (): Promise<RagStatus> => ipcRenderer.invoke('rag:status'),
  ragClear: (): Promise<RagStatus> => ipcRenderer.invoke('rag:clear'),
  onRagProgress: (cb: (p: { phase: string; done: number; total: number }) => void) =>
    on('rag:progress', cb)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
