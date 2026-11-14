/** Tekil oyun durumu + kalıcılık (localStorage, varsa Node.js sunucusu). */
import { useSyncExternalStore } from 'react'
import { newGame, type Sim } from '../flight/world'
import type { GameState } from './types'

const KEY = 'nasagame-save-v2'

function loadLocal(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const gs = JSON.parse(raw) as GameState
    return gs && Array.isArray(gs.vessels) && Array.isArray(gs.design) ? gs : null
  } catch {
    return null
  }
}

export const sim: Sim = { gs: typeof localStorage === 'undefined' ? newGame() : (loadLocal() ?? newGame()), warpIdx: 0, firing: new Map() }

let version = 0
const listeners = new Set<() => void>()

/** Durum değişti: React bileşenlerini yeniden çiz. */
export function bump() {
  version += 1
  listeners.forEach((l) => l())
}

export function useGame(): GameState {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return sim.gs
}

let lastServerSave = 0
export function saveGame() {
  try {
    const json = JSON.stringify(sim.gs)
    localStorage.setItem(KEY, json)
    // Node.js backend çalışıyorsa (npm run server) kaydı oraya da yaz; yoksa sessizce geç.
    if (Date.now() - lastServerSave > 15_000) {
      lastServerSave = Date.now()
      fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => undefined)
    }
  } catch {
    /* depolama kapalı olabilir */
  }
}

export function resetGame() {
  sim.gs = newGame()
  sim.warpIdx = 0
  sim.firing.clear()
  saveGame()
  bump()
}
