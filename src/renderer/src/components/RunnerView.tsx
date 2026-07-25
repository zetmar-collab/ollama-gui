import { useState } from 'react'
import type { AppSettings, OllamaModel, RunnerPreset } from '../../../shared/types'
import { makeT } from '../i18n'

interface Props {
  settings: AppSettings
  models: OllamaModel[]
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  showToast: (msg: string, err?: boolean) => void
}

export default function RunnerView({
  settings,
  models,
  updateSettings,
  showToast
}: Props): JSX.Element {
  const t = makeT(settings.lang)
  const presets = settings.runnerPresets
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? '')
  const [model, setModel] = useState(settings.defaultModel || models[0]?.name || '')
  const preset = presets.find((p) => p.id === selectedId) ?? presets[0]
  const [draft, setDraft] = useState<RunnerPreset>(preset)

  // Synchronizacja draftu przy zmianie wybranego presetu.
  const selectPreset = (id: string): void => {
    setSelectedId(id)
    const p = presets.find((x) => x.id === id)
    if (p) setDraft(p)
  }

  const setField = <K extends keyof RunnerPreset>(k: K, v: RunnerPreset[K]): void => {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  const savePreset = async (): Promise<void> => {
    const next = presets.map((p) => (p.id === draft.id ? draft : p))
    await updateSettings({ runnerPresets: next })
    showToast(t('runner.presetSaved'))
  }

  const launch = async (): Promise<void> => {
    if (!model) {
      showToast(t('runner.selectModel'), true)
      return
    }
    const res = await window.api.launchRunner(draft, model)
    if (res.ok) {
      showToast(t('runner.launched') + draft.command.replace(/\{model\}/g, model))
    } else {
      showToast(t('runner.launchFail') + res.error, true)
    }
  }

  const base = `http://${settings.host}:${settings.port}`
  const proxyBase = `http://127.0.0.1:${settings.proxy.port}`
  const effectiveBase = draft.useProxy
    ? proxyBase
    : draft.openaiCompat
      ? `${base}/v1`
      : base

  return (
    <>
      <div className="topbar">
        <h2>{t('runner.title')}</h2>
      </div>
      <div className="content">
        <div className="section">
          <p className="hint" style={{ marginBottom: 16 }}>
            {t('runner.intro')}
            <code>{base}/v1</code>.
          </p>

          <div className="field">
            <label>{t('runner.tool')}</label>
            <div className="switch" style={{ flexWrap: 'wrap' }}>
              {presets.map((p) => (
                <button
                  key={p.id}
                  className={selectedId === p.id ? 'on' : ''}
                  onClick={() => selectPreset(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="two-col">
            <div className="field">
              <label>{t('runner.model')}</label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.length === 0 && <option value="">{t('chat.noModels')}</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('runner.command')}</label>
              <input value={draft.command} onChange={(e) => setField('command', e.target.value)} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <strong>{t('runner.envTitle')}</strong>
            <div className="two-col" style={{ marginTop: 10 }}>
              <div className="field">
                <label>{t('runner.envUrl')}</label>
                <input
                  value={draft.baseUrlEnv}
                  onChange={(e) => setField('baseUrlEnv', e.target.value)}
                />
              </div>
              <div className="field">
                <label>{t('runner.envUrlVal')}</label>
                <input value={effectiveBase} readOnly />
              </div>
              <div className="field">
                <label>{t('runner.envKey')}</label>
                <input value={draft.apiKeyEnv} onChange={(e) => setField('apiKeyEnv', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('runner.envKeyVal')}</label>
                <input
                  value={draft.apiKeyValue}
                  onChange={(e) => setField('apiKeyValue', e.target.value)}
                />
              </div>
              <div className="field">
                <label>{t('runner.envModel')}</label>
                <input value={draft.modelEnv} onChange={(e) => setField('modelEnv', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('runner.openaiMode')}</label>
                <div className="switch">
                  <button
                    className={draft.openaiCompat ? 'on' : ''}
                    onClick={() => setField('openaiCompat', true)}
                  >
                    {t('runner.yes')}
                  </button>
                  <button
                    className={!draft.openaiCompat ? 'on' : ''}
                    onClick={() => setField('openaiCompat', false)}
                  >
                    {t('runner.no')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="row">
            <button className="primary" onClick={launch}>
              {t('runner.launch')}
            </button>
            <button onClick={savePreset}>{t('runner.savePreset')}</button>
          </div>

          {draft.useProxy && (
            <div className="hint" style={{ marginTop: 14 }}>
              {t('runner.proxyNote', { proxy: proxyBase })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
