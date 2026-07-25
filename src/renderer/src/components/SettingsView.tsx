import { useEffect, useState } from 'react'
import type {
  AppSettings,
  Lang,
  OllamaModel,
  OllamaOptions,
  ProxyStatus,
  RagStatus
} from '../../../shared/types'
import { makeT } from '../i18n'

interface Props {
  settings: AppSettings
  models: OllamaModel[]
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  refreshModels: () => Promise<void>
  online: boolean | null
  showToast: (msg: string, err?: boolean) => void
}

export default function SettingsView({
  settings,
  models,
  updateSettings,
  refreshModels,
  online,
  showToast
}: Props): JSX.Element {
  const t = makeT(settings.lang)
  const [host, setHost] = useState(settings.host)
  const [port, setPort] = useState(String(settings.port))
  const [opts, setOpts] = useState<OllamaOptions>(settings.options)
  const [proxyPort, setProxyPort] = useState(String(settings.proxy.port))
  const [proxyModel, setProxyModel] = useState(settings.proxy.model)
  const [proxy, setProxy] = useState<ProxyStatus>({ running: false, port: settings.proxy.port })
  const [rag, setRag] = useState<RagStatus>({ chunks: 0, files: 0, indexedLibIds: [] })
  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    window.api.proxyStatus().then(setProxy)
    window.api.ragStatus().then(setRag)
    const off = window.api.onRagProgress((p) => setIndexing({ done: p.done, total: p.total }))
    return off
  }, [])

  const setTheme = (theme: 'light' | 'dark'): void => {
    updateSettings({ theme })
  }
  const setLang = (lang: Lang): void => {
    updateSettings({ lang })
  }

  const saveConnection = async (): Promise<void> => {
    const p = parseInt(port, 10)
    if (!host.trim() || isNaN(p)) {
      showToast(t('settings.badAddress'), true)
      return
    }
    await updateSettings({ host: host.trim(), port: p })
    await refreshModels()
    showToast(t('settings.connSaved'))
  }

  const saveOptions = async (): Promise<void> => {
    await updateSettings({ options: opts })
    showToast(t('settings.paramsSaved'))
  }
  const setOpt = <K extends keyof OllamaOptions>(k: K, v: OllamaOptions[K]): void => {
    setOpts((o) => ({ ...o, [k]: v }))
  }

  const toggleProxy = async (): Promise<void> => {
    if (proxy.running) {
      const res = await window.api.proxyStop()
      if (res.ok && res.data) setProxy(res.data)
      showToast(t('settings.proxyStoppedToast'))
    } else {
      await updateSettings({
        proxy: { ...settings.proxy, port: parseInt(proxyPort, 10) || 11435, model: proxyModel }
      })
      const res = await window.api.proxyStart()
      if (res.ok && res.data) {
        setProxy(res.data)
        showToast(t('settings.proxyStartedToast') + (res.data.port ?? proxyPort))
      } else {
        showToast(t('settings.proxyStartFail') + res.error, true)
      }
    }
  }

  const saveProxyCfg = async (): Promise<void> => {
    await updateSettings({
      proxy: { ...settings.proxy, port: parseInt(proxyPort, 10) || 11435, model: proxyModel }
    })
    showToast(t('settings.proxyCfgSaved') + (proxy.running ? t('settings.proxyRestartNote') : ''))
  }

  const baseName = (p: string): string => p.replace(/\\/g, '/').split('/').pop() || p

  const addLibrary = async (): Promise<void> => {
    const dir = await window.api.pickDirectory()
    if (!dir) return
    if (settings.libraries.some((l) => l.path === dir)) {
      showToast(t('settings.libExists'), true)
      return
    }
    const lib = {
      id: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: baseName(dir),
      path: dir,
      enabled: true
    }
    await updateSettings({ libraries: [...settings.libraries, lib] })
    showToast(t('settings.libAdded') + lib.name)
  }
  const removeLibrary = async (id: string): Promise<void> => {
    await updateSettings({ libraries: settings.libraries.filter((l) => l.id !== id) })
  }
  const toggleLibrary = async (id: string): Promise<void> => {
    await updateSettings({
      libraries: settings.libraries.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l))
    })
  }

  // --- RAG ---
  const setRagField = <K extends keyof AppSettings['rag']>(
    k: K,
    v: AppSettings['rag'][K]
  ): void => {
    updateSettings({ rag: { ...settings.rag, [k]: v } })
  }
  const reindex = async (): Promise<void> => {
    setIndexing({ done: 0, total: 0 })
    const res = await window.api.ragReindex()
    setIndexing(null)
    if (res.ok && res.data) {
      setRag(res.data)
      showToast(t('settings.ragDone') + t('settings.ragStatus', { chunks: res.data.chunks, files: res.data.files }))
    } else {
      showToast(t('settings.ragFail') + res.error, true)
    }
  }
  const clearIndex = async (): Promise<void> => {
    const status = await window.api.ragClear()
    setRag(status)
    showToast(t('settings.ragCleared'))
  }

  return (
    <>
      <div className="topbar">
        <h2>{t('nav.settings')}</h2>
      </div>
      <div className="content">
        <div className="section">
          <h3>{t('settings.appearance')}</h3>
          <div className="two-col">
            <div className="field">
              <label>{t('settings.theme')}</label>
              <div className="switch">
                <button
                  className={settings.theme === 'light' ? 'on' : ''}
                  onClick={() => setTheme('light')}
                >
                  {t('settings.light')}
                </button>
                <button
                  className={settings.theme === 'dark' ? 'on' : ''}
                  onClick={() => setTheme('dark')}
                >
                  {t('settings.dark')}
                </button>
              </div>
            </div>
            <div className="field">
              <label>{t('settings.language')}</label>
              <div className="switch">
                <button className={settings.lang === 'pl' ? 'on' : ''} onClick={() => setLang('pl')}>
                  🇵🇱 Polski
                </button>
                <button className={settings.lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
                  🇬🇧 English
                </button>
              </div>
            </div>
          </div>

          <h3>{t('settings.connection')}</h3>
          <div className="two-col">
            <div className="field">
              <label>{t('settings.hostLabel')}</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" />
            </div>
            <div className="field">
              <label>{t('settings.portLabel')}</label>
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="11434" />
            </div>
          </div>
          <div className="row">
            <button className="primary" onClick={saveConnection}>
              {t('settings.saveConnect')}
            </button>
            <span className="status" style={{ padding: 0 }}>
              <span className={`dot ${online === null ? '' : online ? 'ok' : 'bad'}`} />
              {online === null ? '—' : online ? t('settings.connected') : t('settings.noConnection')}
            </span>
          </div>
          <div className="hint">{t('settings.connHint')}</div>

          <h3>{t('settings.genParams')}</h3>
          <div className="two-col">
            <div className="field">
              <label>Temperature ({opts.temperature})</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={opts.temperature}
                onChange={(e) => setOpt('temperature', parseFloat(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Top P ({opts.top_p})</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opts.top_p}
                onChange={(e) => setOpt('top_p', parseFloat(e.target.value))}
              />
            </div>
            <div className="field">
              <label>{t('settings.context')}</label>
              <input
                type="number"
                value={opts.num_ctx}
                onChange={(e) => setOpt('num_ctx', parseInt(e.target.value, 10) || 2048)}
              />
            </div>
            <div className="field">
              <label>{t('settings.keepAlive')}</label>
              <input
                value={opts.keep_alive}
                onChange={(e) => setOpt('keep_alive', e.target.value)}
                placeholder="5m / 30m / -1"
              />
            </div>
          </div>
          <div className="field">
            <label>{t('settings.systemPrompt')}</label>
            <textarea
              rows={3}
              value={opts.system}
              onChange={(e) => setOpt('system', e.target.value)}
              placeholder={t('settings.systemPlaceholder')}
            />
          </div>
          <button className="primary" onClick={saveOptions}>
            {t('settings.saveParams')}
          </button>

          <h3>{t('settings.proxyTitle')}</h3>
          <div className="card">
            <div className="row between">
              <div>
                <strong>{t('settings.status')}</strong>{' '}
                <span style={{ color: proxy.running ? 'var(--ok)' : 'var(--text-dim)' }}>
                  {proxy.running
                    ? `${t('settings.proxyRunning')}${proxy.port}`
                    : t('settings.proxyStopped')}
                </span>
              </div>
              <button className={proxy.running ? 'danger' : 'primary'} onClick={toggleProxy}>
                {proxy.running ? t('settings.proxyStop') : t('settings.proxyStart')}
              </button>
            </div>
            <div className="two-col" style={{ marginTop: 12 }}>
              <div className="field">
                <label>{t('settings.proxyPort')}</label>
                <input value={proxyPort} onChange={(e) => setProxyPort(e.target.value)} placeholder="11435" />
              </div>
              <div className="field">
                <label>{t('settings.proxyModel')}</label>
                <select value={proxyModel} onChange={(e) => setProxyModel(e.target.value)}>
                  <option value="">{t('settings.useDefaultModel')}</option>
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button onClick={saveProxyCfg}>{t('settings.saveProxy')}</button>
            <div className="hint" style={{ marginTop: 10 }}>
              {t('settings.proxyHint')}
            </div>
          </div>

          <h3>{t('settings.libraries')}</h3>
          <div className="hint" style={{ marginBottom: 10 }}>
            {t('settings.librariesHint')}
          </div>
          {settings.libraries.length === 0 && <div className="hint">{t('settings.noLibs')}</div>}
          {settings.libraries.map((l) => (
            <div key={l.id} className="installed-item">
              <div>
                <div>
                  <strong>{l.name}</strong> {l.enabled ? '' : t('settings.disabledMark')}
                </div>
                <div className="meta">{l.path}</div>
              </div>
              <div className="row">
                <button onClick={() => toggleLibrary(l.id)}>
                  {l.enabled ? t('settings.disable') : t('settings.enable')}
                </button>
                <button className="danger" onClick={() => removeLibrary(l.id)}>
                  {t('models.remove')}
                </button>
              </div>
            </div>
          ))}
          <button className="primary" style={{ marginTop: 10 }} onClick={addLibrary}>
            {t('settings.addLib')}
          </button>

          <h3>{t('settings.ragTitle')}</h3>
          <div className="card">
            <div className="field">
              <label className="ctx-listing" style={{ fontSize: 14 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={settings.rag.enabled}
                  onChange={(e) => setRagField('enabled', e.target.checked)}
                />
                {t('settings.ragEnable')}
              </label>
            </div>
            <div className="two-col">
              <div className="field">
                <label>{t('settings.ragModel')}</label>
                <input
                  value={settings.rag.embedModel}
                  onChange={(e) => setRagField('embedModel', e.target.value)}
                  placeholder="nomic-embed-text"
                />
              </div>
              <div className="field">
                <label>{t('settings.ragTopK')}</label>
                <input
                  type="number"
                  value={settings.rag.topK}
                  onChange={(e) => setRagField('topK', parseInt(e.target.value, 10) || 6)}
                />
              </div>
            </div>
            <div className="row">
              <button className="primary" onClick={reindex} disabled={!!indexing}>
                {indexing ? t('settings.ragIndexing') : t('settings.ragReindex')}
              </button>
              <button onClick={clearIndex} disabled={!!indexing}>
                {t('settings.ragClear')}
              </button>
              <span className="meta">
                {t('settings.ragStatus', { chunks: rag.chunks, files: rag.files })}
              </span>
            </div>
            {indexing && indexing.total > 0 && (
              <div className="progress" style={{ marginTop: 8 }}>
                <div style={{ width: `${Math.round((indexing.done / indexing.total) * 100)}%` }} />
              </div>
            )}
            <div className="hint" style={{ marginTop: 10 }}>
              {t('settings.ragHint')}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
