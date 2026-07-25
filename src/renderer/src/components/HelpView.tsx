import type { TFn } from '../i18n'

interface Props {
  t: TFn
}

const SECTIONS: [string, string][] = [
  ['help.intro.t', 'help.intro.b'],
  ['help.conn.t', 'help.conn.b'],
  ['help.chat.t', 'help.chat.b'],
  ['help.models.t', 'help.models.b'],
  ['help.runner.t', 'help.runner.b'],
  ['help.rag.t', 'help.rag.b'],
  ['help.shortcuts.t', 'help.shortcuts.b'],
  ['help.tips.t', 'help.tips.b']
]

export default function HelpView({ t }: Props): JSX.Element {
  return (
    <>
      <div className="topbar">
        <h2>{t('nav.help')}</h2>
      </div>
      <div className="content">
        <div className="section" style={{ maxWidth: 820 }}>
          <div className="help-hero">
            <div className="logo help-logo">🦙</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Ollama GUI</div>
              <div className="hint" style={{ marginTop: 2 }}>
                {t('help.subtitle')} · v1.0.0
              </div>
            </div>
          </div>

          {SECTIONS.map(([titleKey, bodyKey]) => (
            <div key={titleKey} className="help-card">
              <h3 className="help-title">{t(titleKey)}</h3>
              <p className="help-body">{t(bodyKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
