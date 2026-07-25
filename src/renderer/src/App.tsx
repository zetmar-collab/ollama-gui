import { useEffect, useState, useCallback } from 'react'
import type { AppSettings, OllamaModel } from '../../shared/types'
import ChatView from './components/ChatView'
import ModelsView from './components/ModelsView'
import SettingsView from './components/SettingsView'
import RunnerView from './components/RunnerView'
import HelpView from './components/HelpView'
import { makeT } from './i18n'

type View = 'chat' | 'models' | 'runner' | 'settings' | 'help'

export interface Toast {
  msg: string
  err?: boolean
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [view, setView] = useState<View>('chat')
  const [models, setModels] = useState<OllamaModel[]>([])
  const [online, setOnline] = useState<boolean | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  const showToast = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // Wczytanie ustawien na starcie.
  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  // Zastosowanie motywu.
  useEffect(() => {
    if (settings) document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings?.theme])

  const refreshModels = useCallback(async () => {
    const health = await window.api.health()
    setOnline(health.ok)
    if (health.ok) {
      const res = await window.api.listModels()
      if (res.ok && res.data) setModels(res.data)
    } else {
      setModels([])
    }
  }, [])

  useEffect(() => {
    if (settings) refreshModels()
  }, [settings?.host, settings?.port, refreshModels])

  // Odpytywanie statusu co 10 s.
  useEffect(() => {
    const t = setInterval(refreshModels, 10000)
    return () => clearInterval(t)
  }, [refreshModels])

  // Globalne skroty klawiszowe (nawigacja + pomoc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault()
          setView((['chat', 'models', 'runner', 'settings'] as View[])[Number(e.key) - 1])
        } else if (e.key === ',') {
          e.preventDefault()
          setView('settings')
        } else if (e.key === '/') {
          e.preventDefault()
          setShowHelp((h) => !h)
        }
      } else if (e.key === 'Escape') {
        setShowHelp(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.api.setSettings(patch)
    setSettings(next)
    return next
  }, [])

  if (!settings) {
    return (
      <div className="app">
        <div className="empty" style={{ margin: 'auto' }}>
          Loading...
        </div>
      </div>
    )
  }

  const t = makeT(settings.lang)

  const nav: { id: View; icon: string; label: string }[] = [
    { id: 'chat', icon: '💬', label: t('nav.chat') },
    { id: 'models', icon: '📦', label: t('nav.models') },
    { id: 'runner', icon: '🚀', label: t('nav.runner') },
    { id: 'settings', icon: '⚙️', label: t('nav.settings') }
  ]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">🦙</div>
          Ollama GUI
        </div>
        {nav.map((n) => (
          <button
            key={n.id}
            className={`nav-item ${view === n.id ? 'active' : ''}`}
            onClick={() => setView(n.id)}
          >
            <span>{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <button
          className={`nav-item ${view === 'help' ? 'active' : ''}`}
          onClick={() => setView('help')}
        >
          <span>❓</span>
          {t('nav.help')}
        </button>
        <button className="nav-item" onClick={() => setShowHelp(true)} title={t('sc.tooltip')}>
          <span>⌨️</span>
          {t('sc.title')}
        </button>
        <div className="status">
          <span className={`dot ${online === null ? '' : online ? 'ok' : 'bad'}`} />
          {online === null ? t('status.checking') : online ? t('status.online') : t('status.offline')}
        </div>
        <div className="status" style={{ paddingTop: 0 }}>
          {settings.host}:{settings.port}
        </div>
      </aside>

      <main className="main">
        {view === 'chat' && (
          <ChatView
            settings={settings}
            models={models}
            online={!!online}
            updateSettings={updateSettings}
            showToast={showToast}
          />
        )}
        {view === 'models' && (
          <ModelsView
            models={models}
            online={!!online}
            refreshModels={refreshModels}
            showToast={showToast}
            t={t}
          />
        )}
        {view === 'runner' && (
          <RunnerView
            settings={settings}
            models={models}
            updateSettings={updateSettings}
            showToast={showToast}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            models={models}
            updateSettings={updateSettings}
            refreshModels={refreshModels}
            online={online}
            showToast={showToast}
          />
        )}
        {view === 'help' && <HelpView t={t} />}
      </main>

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 18 }}>{t('sc.title')}</h2>
              <button onClick={() => setShowHelp(false)}>{t('sc.close')}</button>
            </div>
            {(
              [
                ['sc.newChat', 'Ctrl + N'],
                ['sc.search', 'Ctrl + F'],
                ['sc.export', 'Ctrl + E'],
                ['sc.send', 'Enter'],
                ['sc.newline', 'Shift + Enter'],
                ['sc.stop', 'Esc'],
                ['sc.tabs', 'Ctrl + 1 … 4'],
                ['sc.settings', 'Ctrl + ,'],
                ['sc.help', 'Ctrl + /']
              ] as [string, string][]
            ).map(([key, combo]) => (
              <div key={key} className="sc-row">
                <span>{t(key)}</span>
                <kbd>{combo}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
