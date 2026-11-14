/** Tekil oyun durumu, hesap oturumu ve hesaba özel kalıcılık. */
import { useSyncExternalStore } from 'react'
import { SHIP_SLOT_COUNT } from './data'
import { STARTER_EARTH_MODULES } from './base'
import { INITIAL_TECH } from './tech'
import type { GameState } from './types'
import { PAD_ANGLE } from '../flight/physics'
import { newGame, type Sim, tickBasesOnly } from '../flight/world'

const KEY_PREFIX = 'nasagame-save-v3:'

export interface AuthUser {
  username: string
}

export interface OfflineGain {
  money: number
  seconds: number
}

export const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }

let authUser: AuthUser | null = null
let authChecked = false
let offlineGain: OfflineGain | null = null
let idleWarp = 1

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

export function useAuthState() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  return { user: authUser, checked: authChecked, offlineGain, idleWarp }
}

export function clearOfflineGain() {
  offlineGain = null
  bump()
}

export function setIdleWarp(w: number) {
  idleWarp = Math.max(1, Math.min(25, w))
  bump()
}

export function normalizeGameState(raw: unknown): GameState {
  const base = newGame()
  if (!raw || typeof raw !== 'object') return base
  const gs = raw as Partial<GameState>
  if (!Array.isArray(gs.vessels) || !Array.isArray(gs.design)) return base
  const merged: GameState = {
    ...base,
    ...gs,
    bases: { ...(gs.bases ?? {}) },
    missionsDone: Array.isArray(gs.missionsDone) ? [...gs.missionsDone] : [],
    techDone: Array.isArray(gs.techDone) && gs.techDone.length ? [...new Set([INITIAL_TECH, ...gs.techDone])] : [INITIAL_TECH],
    designCargo: gs.designCargo ? { ...gs.designCargo } : {},
    targetBody: gs.targetBody ?? 'moon',
    shipSlots: Array.from({ length: SHIP_SLOT_COUNT }, (_, i) => (Array.isArray(gs.shipSlots) ? gs.shipSlots[i] ?? null : null)),
  }
  if (!merged.bases.earth) {
    merged.bases.earth = {
      modules: { ...STARTER_EARTH_MODULES },
      ore: 0,
      siteAngle: PAD_ANGLE,
      earned: 0,
    }
  }
  const now = Date.now()
  if (typeof gs.lastSavedAt === 'number' && now - gs.lastSavedAt > 5000) {
    const elapsedSec = Math.min(24 * 3600, (now - gs.lastSavedAt) / 1000)
    const gained = tickBasesOnly(merged, elapsedSec)
    if (gained >= 1) {
      offlineGain = { money: gained, seconds: elapsedSec }
    }
  }
  merged.lastSavedAt = now
  return merged
}

function loadLocalForUser(username: string): GameState | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(`${KEY_PREFIX}${username.toLowerCase()}`)
    if (!raw) return null
    return normalizeGameState(JSON.parse(raw))
  } catch {
    return null
  }
}

function loadFromAccountSave(username: string, serverSave: unknown) {
  offlineGain = null
  if (serverSave && typeof serverSave === 'object') {
    sim.gs = normalizeGameState(serverSave)
  } else {
    sim.gs = loadLocalForUser(username) ?? newGame()
  }
  sim.warpIdx = 0
  sim.firing.clear()
}

let lastServerSave = 0
export function saveGame(force = false): Promise<void> {
  if (!authUser) return Promise.resolve()
  try {
    sim.gs.lastSavedAt = Date.now()
    const json = JSON.stringify(sim.gs)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${KEY_PREFIX}${authUser.username.toLowerCase()}`, json)
    }
    if (force || Date.now() - lastServerSave > 4000) {
      lastServerSave = Date.now()
      return fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      })
        .then(() => undefined)
        .catch(() => undefined)
    }
  } catch {
    /* depolama kapalı olabilir */
  }
  return Promise.resolve()
}

export async function initAuth() {
  try {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const data = (await res.json()) as { user: AuthUser | null }
      if (data.user) {
        authUser = data.user
        const saveRes = await fetch('/api/save')
        const saveData = saveRes.ok ? await saveRes.json() : null
        loadFromAccountSave(data.user.username, saveData)
      }
    }
  } catch {
    /* sunucu erişilemezse giriş ekranında gösterilir */
  } finally {
    authChecked = true
    bump()
  }
}

export async function loginAccount(username: string, password: string): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.headers.get('content-type')?.includes('application/json')) {
      return `Hesap sunucusu geçersiz yanıt verdi (HTTP ${res.status}). Geliştirme sunucusunu yeniden başlatın: npm run dev.`
    }
    const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; save?: unknown; error?: string }
    if (!res.ok || !data.user) return data.error ?? 'Giriş başarısız.'
    authUser = data.user
    loadFromAccountSave(data.user.username, data.save ?? null)
    await saveGame(true)
    bump()
    return null
  } catch {
    return 'Hesap sunucusuna bağlanılamadı (npm run server çalışıyor mu?).'
  }
}

export async function registerAccount(username: string, password: string): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.headers.get('content-type')?.includes('application/json')) {
      return `Hesap sunucusu geçersiz yanıt verdi (HTTP ${res.status}). Geliştirme sunucusunu yeniden başlatın: npm run dev.`
    }
    const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string }
    if (!res.ok || !data.user) return data.error ?? 'Hesap oluşturulamadı.'
    authUser = data.user
    offlineGain = null
    sim.gs = newGame()
    sim.warpIdx = 0
    sim.firing.clear()
    await saveGame(true)
    bump()
    return null
  } catch {
    return 'Hesap sunucusuna bağlanılamadı (npm run server çalışıyor mu?).'
  }
}

export async function logoutAccount() {
  await saveGame(true)
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    /* yoksay */
  }
  authUser = null
  offlineGain = null
  sim.gs = newGame()
  sim.warpIdx = 0
  sim.firing.clear()
  bump()
}

export function resetGame() {
  offlineGain = null
  sim.gs = newGame()
  sim.warpIdx = 0
  sim.firing.clear()
  void saveGame(true)
  bump()
}

// Geliştirici konsolundan erişim (hata ayıklama / demo senaryoları için).
if (typeof window !== 'undefined') (window as unknown as { __sim: Sim }).__sim = sim
