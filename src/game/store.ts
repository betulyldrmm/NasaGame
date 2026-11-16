/** Tekil oyun durumu, hesap oturumu ve hesaba özel kalıcılık. */
import { useSyncExternalStore } from 'react'
import { PART_BY_ID, SHIP_SLOT_COUNT } from './data'
import { emptyBase, ensureSites, STARTER_EARTH_SITES, syncModules } from './base'
import { INITIAL_TECH } from './tech'
import type { GameCommand, GameState } from './types'
import { BODIES, type BodyId } from '../nasa/bodies'
import { PAD_ANGLE } from '../flight/physics'
import { dispatchCommand, newGame, type Sim, tickBasesOnly } from '../flight/world'
import { getMpSim, isMpMatchActive, sendMpCommand, useMultiplayer } from '../flight/mpClient'

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

export function getActiveSim(): Sim {
  return isMpMatchActive() ? (getMpSim() ?? sim) : sim
}

export function useActiveGame(): GameState {
  const spGs = useGame()
  const mp = useMultiplayer()
  if (mp.active && mp.inMatch) {
    return getMpSim()?.gs ?? spGs
  }
  return spGs
}

export function runCommand(cmd: GameCommand) {
  if (isMpMatchActive()) {
    const res = sendMpCommand(cmd)
    return { events: res.events ?? [], error: res.error }
  }
  const res = dispatchCommand(sim, cmd, authUser?.username ?? 'local')
  void saveGame(true)
  bump()
  return res
}

export function normalizeGameState(raw: unknown): GameState {
  const base = newGame()
  if (!raw || typeof raw !== 'object') return base
  const gs = raw as Partial<GameState>
  if (!Array.isArray(gs.vessels) || !Array.isArray(gs.design)) return base
  const sanitizeParts = <T extends { def?: string }>(arr: T[]) => arr.filter((p) => p && typeof p.def === 'string' && Boolean(PART_BY_ID[p.def]))
  const targetBody = gs.targetBody && BODIES[gs.targetBody] && gs.targetBody !== 'sun' ? gs.targetBody : 'moon'
  const merged: GameState = {
    ...base,
    ...gs,
    money: typeof gs.money === 'number' && Number.isFinite(gs.money) ? gs.money : base.money,
    time: typeof gs.time === 'number' && Number.isFinite(gs.time) ? gs.time : 0,
    nextId: typeof gs.nextId === 'number' && Number.isFinite(gs.nextId) && gs.nextId >= 1 ? Math.floor(gs.nextId) : base.nextId,
    design: sanitizeParts(gs.design),
    bases: { ...(gs.bases ?? {}) },
    missionsDone: Array.isArray(gs.missionsDone) ? [...gs.missionsDone] : [],
    techDone: [INITIAL_TECH],
    designCargo: gs.designCargo ? { ...gs.designCargo } : {},
    targetBody,
    shipSlots: Array.from({ length: SHIP_SLOT_COUNT }, (_, i) => {
      const slot = Array.isArray(gs.shipSlots) ? gs.shipSlots[i] ?? null : null
      if (!slot || !Array.isArray(slot.design)) return null
      return { ...slot, design: sanitizeParts(slot.design) }
    }),
  }
  merged.vessels = merged.vessels
    .filter((v) => v && !v.debris && v.bodyId && Boolean(BODIES[v.bodyId]) && Array.isArray(v.parts))
    .map((v) => ({ ...v, parts: sanitizeParts(v.parts) }))
    .filter((v) => v.parts.length > 0)
  if (!merged.bases.earth) {
    merged.bases.earth = emptyBase(PAD_ANGLE)
    merged.bases.earth.sites = [...STARTER_EARTH_SITES]
    syncModules(merged.bases.earth)
  }
  for (const id of Object.keys(merged.bases) as BodyId[]) {
    const b = merged.bases[id]
    if (b) {
      ensureSites(b)
      syncModules(b)
    }
  }
  const now = Date.now()
  if (typeof gs.lastSavedAt === 'number' && now - gs.lastSavedAt > 5000) {
    const elapsedSec = Math.min(8 * 3600, (now - gs.lastSavedAt) / 1000)
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
  const localSave = loadLocalForUser(username)
  const serverTs =
    serverSave && typeof serverSave === 'object' && typeof (serverSave as Partial<GameState>).lastSavedAt === 'number'
      ? (serverSave as Partial<GameState>).lastSavedAt!
      : 0
  if (serverSave && typeof serverSave === 'object' && (!localSave || serverTs >= (localSave.lastSavedAt ?? 0))) {
    sim.gs = normalizeGameState(serverSave)
  } else {
    sim.gs = localSave ?? newGame(username)
  }
  sim.gs.ownerId = username
  sim.gs.players = { ...(sim.gs.players ?? {}), [username]: { id: username, username } }
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
        const saveRes = await fetch('/api/save').catch(() => null)
        const saveData = saveRes && saveRes.ok ? await saveRes.json().catch(() => null) : null
        loadFromAccountSave(data.user.username, saveData)
        authUser = data.user
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
    sim.gs = newGame(data.user.username)
    sim.warpIdx = 0
    sim.firing.clear()
    await saveGame(true)
    bump()
    return null
  } catch {
    return 'Hesap sunucusuna bağlanılamadı (npm run server çalışıyor mu?).'
  }
}

let loggingOut = false
export async function logoutAccount() {
  if (loggingOut) return
  loggingOut = true
  try {
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
  } finally {
    loggingOut = false
  }
}

export function resetGame() {
  offlineGain = null
  sim.gs = newGame(authUser?.username ?? 'local')
  sim.warpIdx = 0
  sim.firing.clear()
  void saveGame(true)
  bump()
}

// Geliştirici konsolundan erişim (hata ayıklama / demo senaryoları için).
if (typeof window !== 'undefined') (window as unknown as { __sim: Sim }).__sim = sim
