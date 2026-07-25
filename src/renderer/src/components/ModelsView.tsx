import { useEffect, useMemo, useState } from 'react'
import type { CatalogModel, OllamaModel } from '../../../shared/types'
import type { TFn } from '../i18n'

interface Props {
  models: OllamaModel[]
  online: boolean
  refreshModels: () => Promise<void>
  showToast: (msg: string, err?: boolean) => void
  t: TFn
}

interface PullState {
  id: string
  name: string
  status: string
  percent?: number
}

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  const gb = bytes / 1e9
  if (gb >= 1) return gb.toFixed(1) + ' GB'
  return (bytes / 1e6).toFixed(0) + ' MB'
}

export default function ModelsView({ models, online, refreshModels, showToast, t }: Props): JSX.Element {
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [query, setQuery] = useState('')
  const [pull, setPull] = useState<PullState | null>(null)

  useEffect(() => {
    window.api.catalog().then(setCatalog)
  }, [])

  // Subskrypcja postepu pobierania.
  useEffect(() => {
    const offP = window.api.onPullProgress((p) => {
      setPull((cur) => (cur && cur.id === p.id ? { ...cur, status: p.status, percent: p.percent } : cur))
    })
    const offD = window.api.onPullDone((p) => {
      setPull((cur) => {
        if (cur && cur.id === p.id) {
          showToast(t('models.installedToast') + cur.name)
          refreshModels()
          return null
        }
        return cur
      })
    })
    const offE = window.api.onPullError((p) => {
      setPull((cur) => {
        if (cur && cur.id === p.id) {
          showToast(t('models.pullError') + p.error, true)
          return null
        }
        return cur
      })
    })
    return () => {
      offP()
      offD()
      offE()
    }
  }, [refreshModels, showToast])

  const installedNames = useMemo(() => new Set(models.map((m) => m.name)), [models])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    )
  }, [catalog, query])

  const startPull = async (name: string): Promise<void> => {
    if (!online) {
      showToast(t('models.offline'), true)
      return
    }
    if (pull) {
      showToast(t('models.waitPull'), true)
      return
    }
    const id = `pull-${Date.now()}`
    setPull({ id, name, status: 'start' })
    const res = await window.api.startPull(id, name)
    if (!res.ok) {
      showToast(t('models.startFail') + res.error, true)
      setPull(null)
    }
  }

  const cancelPull = (): void => {
    if (pull) window.api.stopPull(pull.id)
  }

  const removeModel = async (name: string): Promise<void> => {
    const res = await window.api.deleteModel(name)
    if (res.ok) {
      showToast(t('models.deletedToast') + name)
      refreshModels()
    } else {
      showToast(t('models.deleteError') + res.error, true)
    }
  }

  // Nazwa do pobrania z wpisanego zapytania (obsluga "nazwa:tag").
  const customName = query.trim()
  const customIsKnown = catalog.some((c) => c.name === customName.split(':')[0])

  return (
    <>
      <div className="topbar">
        <h2>{t('nav.models')}</h2>
        <button onClick={refreshModels}>{t('models.refresh')}</button>
      </div>
      <div className="content">
        <div className="field" style={{ maxWidth: 560 }}>
          <label>{t('models.searchLabel')}</label>
          <div className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('models.searchPlaceholder')}
            />
            {customName && !customIsKnown && (
              <button className="primary" onClick={() => startPull(customName)} disabled={!!pull}>
                {t('models.download')} "{customName}"
              </button>
            )}
          </div>
          <div className="hint">{t('models.searchHint')}</div>
        </div>

        {pull && (
          <div className="card" style={{ maxWidth: 560, marginBottom: 18 }}>
            <div className="row between">
              <strong>
                {t('models.downloading')}
                {pull.name}
              </strong>
              <button className="danger" onClick={cancelPull}>
                {t('models.cancel')}
              </button>
            </div>
            <div className="hint">{pull.status}</div>
            <div className="progress">
              <div style={{ width: `${pull.percent ?? 5}%` }} />
            </div>
          </div>
        )}

        {models.length > 0 && (
          <div className="section" style={{ maxWidth: 720, marginBottom: 24 }}>
            <h3>
              {t('models.installed')} ({models.length})
            </h3>
            {models.map((m) => (
              <div key={m.name} className="installed-item">
                <div>
                  <div>
                    <strong>{m.name}</strong>
                  </div>
                  <div className="meta">
                    {fmtSize(m.size)} {m.details?.parameter_size ? `· ${m.details.parameter_size}` : ''}{' '}
                    {m.details?.quantization_level ? `· ${m.details.quantization_level}` : ''}
                  </div>
                </div>
                <button className="danger" onClick={() => removeModel(m.name)}>
                  {t('models.remove')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="section" style={{ maxWidth: '100%' }}>
          <h3>{t('models.library')}</h3>
          <div className="grid">
            {filtered.map((c) => (
              <div key={c.name} className="card">
                <div className="row between">
                  <h3>{c.name}</h3>
                  <span className="tag">{c.category}</span>
                </div>
                <p>{c.description}</p>
                <div>
                  {c.sizes.map((s) => {
                    const full = s === 'latest' ? c.name : `${c.name}:${s}`
                    const installed = installedNames.has(full) || installedNames.has(`${full}:latest`)
                    return (
                      <span
                        key={s}
                        className="chip"
                        onClick={() => startPull(full)}
                        title={installed ? t('models.installedTip') : t('models.downloadTip')}
                        style={installed ? { borderColor: 'var(--ok)', color: 'var(--ok)' } : undefined}
                      >
                        {installed ? '✓ ' : '↓ '}
                        {s}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {filtered.length === 0 && customName && (
            <div className="hint">{t('models.notInList')}</div>
          )}
        </div>
      </div>
    </>
  )
}
