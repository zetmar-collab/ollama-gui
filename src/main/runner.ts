import { spawn } from 'child_process'
import type { RunnerPreset } from '../shared/types'

export interface LaunchParams {
  preset: RunnerPreset
  base: string
  proxyBase: string
  model: string
  cwd?: string
}

// Uruchamia narzedzie CLI (Codex, Aider, Claude Code, wlasne) w NOWYM oknie
// terminala Windows, ze zmiennymi srodowiskowymi wskazujacymi na Ollame
// (lub na wbudowane proxy Anthropic->Ollama, gdy preset.useProxy).
export function launchTool(params: LaunchParams): { command: string } {
  const { preset, base, proxyBase, model } = params
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }

  const target = preset.useProxy ? proxyBase : base
  const baseUrl = preset.useProxy ? target : preset.openaiCompat ? `${target}/v1` : target
  if (preset.baseUrlEnv) env[preset.baseUrlEnv] = baseUrl
  if (preset.apiKeyEnv) env[preset.apiKeyEnv] = preset.apiKeyValue || 'ollama'
  if (preset.modelEnv && model) env[preset.modelEnv] = model
  for (const [k, v] of Object.entries(preset.extraEnv || {})) env[k] = v

  // Podmiana {model} w poleceniu.
  const command = (preset.command || 'cmd').replace(/\{model\}/g, model || '')

  // Otwieramy nowe okno cmd, ktore zostaje otwarte (/k), aby uzytkownik
  // widzial narzedzie. Nowe okno dziedziczy przekazane env.
  const child = spawn('cmd.exe', ['/c', 'start', '"Ollama GUI"', 'cmd', '/k', command], {
    env,
    cwd: params.cwd || process.env.USERPROFILE || undefined,
    detached: true,
    windowsHide: false,
    shell: false
  })
  child.unref()

  return { command }
}
