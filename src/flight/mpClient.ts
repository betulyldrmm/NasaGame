/**
 * Çok oyunculu ağ istemcisi ve ev sahibi (Host) otoriter simülasyon yöneticisi.
 * Host tarayıcı fiziği adım adım yürütür ve anlık durumları aktarır;
 * istemci tarayıcılar ise kareler arasında yörünge/konum ara kestirimi (dead-reckoning) yaparak akıcı 60 FPS çizer.
 */
import { useSyncExternalStore } from 'react'
import { BODIES, type BodyId } from '../nasa/bodies'
import { COMBAT_PRESETS, DEFAULT_DESIGN } from '../game/data'
import type {
  AutopilotMode,
  GameCommand,
  GameEvent,
  GameState,
  MultiplayerConfig,
  PartInst,
  Projectile,
  Vessel,
} from '../game/types'
import { INITIAL_TECH } from '../game/tech'
import { isWarfareMode } from './combat'
import { effectiveAutopilot, stepPhysics, stepRails, type Controls } from './physics'
import {
  addMultiplayerPlayer,
  newMultiplayerGame,
  PHYSICS_WARP_MAX_IDX,
  pushMpFeed,
  removeMultiplayerPlayer,
  WARPS,
} from './multiplayerSim'
import { dispatchCommand, type Fx, type Sim, stepCruise, stepWorld } from './world'

export interface PublicRoomInfo {
  code: string
  name: string
  hostName: string
  started: boolean
  playerCount: number
  maxPlayers: number
  config: MultiplayerConfig
}

export interface RoomMemberInfo {
  id: string
  username: string
  color: string
  slot: number
  isHost: boolean
}

export interface RoomSnapshot {
  code: string
  name: string
  hostId: string
  hostName: string
  started: boolean
  maxPlayers?: number
  config: MultiplayerConfig
  players: RoomMemberInfo[]
}

export interface MpIdentity {
  id: string
  username: string
  color: string
  slot: number
}

export interface MpChatMessage {
  id: number
  fromId: string
  username: string
  color: string
  text: string
  time: number
}

export interface MpViewState {
  active: boolean
  connected: boolean
  connecting: boolean
  error: string | null
  pingMs: number | null
  rooms: PublicRoomInfo[]
  room: RoomSnapshot | null
  you: MpIdentity | null
  isHost: boolean
  inMatch: boolean
  chat: MpChatMessage[]
  version: number
}

export interface SnapshotWire extends GameState {
  _warpIdx?: number
  _firing?: [number, [number, number][]][]
  _fx?: Fx[]
  _clock?: number
  _omitStatic?: boolean
  /** Ev sahibinin sunucuya gidiş-dönüş süresi (ms): istemci gecikme tahmini için */
  _hostPing?: number
}

/** Ağ üzerindeki araç: yapı (parçalar) yalnızca değişince gönderilir; yakıt/can/cephane/silah şarjı kısa listedir. */
type WireVessel = Omit<Vessel, 'parts'> & {
  parts?: PartInst[]
  _pk?: string
  _pf?: [number, number][]
  _ph?: [number, number][]
  _pa?: [number, number][]
  _pc?: [number, number, number, number, number][]
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 10000) / 10000

/** Parçaların yapısal imzası: parça kimliği, konumu, açılma ve motor durumları. Değişince tam yapı gönderilir. */
function partsKey(parts: PartInst[]): string {
  let k = `${parts.length}:`
  for (const p of parts) {
    k += `${p.def}@${p.x},${p.y}${(p.deployed ? 'd' : '')}${(p.on === false ? 'o' : '')}|`
  }
  return k
}
const sentPartsKey = new WeakMap<Sim, Map<number, { key: string; lastFull: number }>>()

function compactVessel(v: Vessel, withParts: boolean, key?: string, clock = 0): WireVessel {
  const { parts, ...rest } = v
  const out: WireVessel = {
    ...rest,
    pos: { x: r2(v.pos.x), y: r2(v.pos.y) },
    vel: { x: r4(v.vel.x), y: r4(v.vel.y) },
    angle: r4(v.angle),
    angVel: r4(v.angVel),
    throttle: r4(v.throttle),
    ec: r2(v.ec),
    dvUsed: Math.round(v.dvUsed),
    ...(v.shield !== undefined ? { shield: r2(v.shield) } : {}),
    ...(v.aimAngle !== undefined ? { aimAngle: r4(v.aimAngle) } : {}),
  }
  if (key) out._pk = key
  if (withParts) out.parts = parts
  else {
    const pf: [number, number][] = []
    const ph: [number, number][] = []
    const pa: [number, number][] = []
    const pc: [number, number, number, number, number][] = []
    parts.forEach((p, i) => {
      if (p.fuel !== undefined) pf.push([i, Math.round(p.fuel * 1000) / 1000])
      if (p.hp !== undefined) ph.push([i, Math.round(p.hp)])
      if (p.ammo !== undefined) pa.push([i, p.ammo])
      const beamRem = p.beamUntil && p.beamUntil > clock ? Math.round((p.beamUntil - clock) * 100) / 100 : 0
      const fireAge = p.fireAt !== undefined && clock - p.fireAt < 0.35 ? Math.round((clock - p.fireAt) * 100) / 100 : -1
      const ch = p.charge ? Math.round(p.charge * 100) / 100 : 0
      const cd = p.cd && p.cd > 0.01 ? Math.round(p.cd * 100) / 100 : 0
      if (ch > 0 || beamRem > 0 || fireAge >= 0 || cd > 0) pc.push([i, ch, beamRem, fireAge, cd])
    })
    out._pf = pf
    if (ph.length) out._ph = ph
    if (pa.length) out._pa = pa
    if (pc.length) out._pc = pc
  }
  return out
}

type ServerMessage =
  | { type: 'pong'; t: number }
  | { type: 'rooms'; rooms: PublicRoomInfo[] }
  | { type: 'roomJoined'; isHost: boolean; you: MpIdentity; room: RoomSnapshot }
  | { type: 'roomState'; room: RoomSnapshot }
  | { type: 'peerJoined'; player: { id: string; username: string; color: string; slot: number } }
  | { type: 'peerLeft'; playerId: string }
  | { type: 'roomClosed'; reason: string }
  | { type: 'leftRoom' }
  | { type: 'matchStarted'; room: RoomSnapshot }
  | { type: 'peerCmd'; fromId: string; cmd: GameCommand }
  | { type: 'peerCtrl'; fromId: string; ctrl: Controls }
  | { type: 'requestParts'; vesselId: number }
  | { type: 'snapshot'; state: SnapshotWire; events?: GameEvent[] }
  | { type: 'chat'; fromId: string; username: string; color: string; text: string }
  | { type: 'error'; message: string }

let ws: WebSocket | null = null
let connectPromise: Promise<void> | null = null
const sendQueue: string[] = []

let active = false
let connected = false
let connecting = false
let error: string | null = null
let pingMs: number | null = null
let pingIntervalId = 0
let rooms: PublicRoomInfo[] = []
let room: RoomSnapshot | null = null
let you: MpIdentity | null = null
let isHost = false
let inMatch = false
let chat: MpChatMessage[] = []
let chatNextId = 1
let version = 0

let hostSim: Sim | null = null
let clientSim: Sim | null = null
let localDesign: PartInst[] = DEFAULT_DESIGN.map((p) => ({ ...p }))
let localDesignCargo: Record<string, number> = {}

const peerControls = new Map<string, Controls>()
let pendingHostEvents: GameEvent[] = []
let lastSnapshotSentAt = 0
let lastStaticSentAt = 0
let staticDirty = true
let forceImmediateSnapshot = false
let lastClientSnapAt = 0
let urgentSnapshot = false
let lastSentCtrl: Controls = { rotate: 0, tx: 0, ty: 0 }
let lastSentCtrlAt = 0
/** İstemci tahmini: yerel tuşlar, son gönderilen burun yönü ve ev sahibinin pingi */
let localCtrl: Controls = { rotate: 0, tx: 0, ty: 0 }
let lastSentAngle = 0
let lastHostPing = 0
let lastLoopAt = 0
let rafId = 0
let bgWorker: Worker | null = null
let bgWorkerUrl: string | null = null
let bgIntervalId = 0
let lastUiBumpAt = 0
let lastPingSentAt = 0
const lastPartsReqAt = new Map<number, number>()

let pendingLaunchUntil = 0
let pendingLaunchMinId = 0
let pendingThrottle: { vesselId: number; value: number; until: number } | null = null
let pendingActive: { vesselId: number; until: number } | null = null
let pendingAutopilot: { vesselId: number; mode: AutopilotMode; until: number } | null = null
let pendingTarget: { bodyId: BodyId; until: number } | null = null
let pendingWarpPref: { warpIdx: number; anchor?: boolean; until: number } | null = null

const STATIC_DIRTY_CMDS = new Set<GameCommand['type']>([
  'buyModule',
  'placeGridModule',
  'removeGridModule',
  'deployModules',
  'pickupModule',
  'loadOre',
  'refuelAtBase',
])

function wrapPi(a: number): number {
  const tau = Math.PI * 2
  return ((((a + Math.PI) % tau) + tau) % tau) - Math.PI
}

/** Görsel konum farkı tamponu (m): sunucu anlık görüntüsü ile yerel tahmin arasındaki farkı kareler boyunca yumuşatır. */
const vesselVisualOffsets = new Map<number, { bodyId: string; x: number; y: number }>()

/** Çok oyunculu istemcide görsel olarak yumuşatılmış konumu verir (fiziksel v.pos'u bozmaz). */
export function getVisualPos(v: Vessel): { x: number; y: number } {
  if (isHost || !clientSim) return v.pos
  const off = vesselVisualOffsets.get(v.id)
  if (!off || off.bodyId !== v.bodyId) return v.pos
  return { x: v.pos.x + off.x, y: v.pos.y + off.y }
}

function clearPendingOptimistic() {
  pendingLaunchUntil = 0
  pendingLaunchMinId = 0
  pendingThrottle = null
  pendingActive = null
  pendingAutopilot = null
  pendingTarget = null
  pendingWarpPref = null
  vesselVisualOffsets.clear()
  knownVesselParts.clear()
  knownPartsKey.clear()
  lastPartsReqAt.clear()
}

const storeListeners = new Set<() => void>()
const eventListeners = new Set<(events: GameEvent[]) => void>()

let cachedView: MpViewState | null = null

function rebuildView(): MpViewState {
  cachedView = {
    active,
    connected,
    connecting,
    error,
    pingMs,
    rooms,
    room,
    you,
    isHost,
    inMatch,
    chat,
    version,
  }
  return cachedView
}

function emitUi(force = false) {
  const now = performance.now()
  if (!force && now - lastUiBumpAt < 95) return
  lastUiBumpAt = now
  version += 1
  rebuildView()
  for (const fn of storeListeners) fn()
}

function notifyEvents(events: GameEvent[]) {
  if (!events.length) return
  const mine = you?.id
  const visible = events.filter((ev) => !('ownerId' in ev) || !ev.ownerId || ev.ownerId === mine)
  if (!visible.length) return
  for (const fn of eventListeners) fn(visible)
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/mp/ws`
}

function sendRaw(obj: Record<string, unknown>) {
  const raw = JSON.stringify(obj)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(raw)
  } else {
    sendQueue.push(raw)
    void ensureConnected()
  }
}

function flushQueue() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  while (sendQueue.length > 0) {
    const item = sendQueue.shift()!
    ws.send(item)
  }
}

function startPingTimer() {
  stopPingTimer()
  lastPingSentAt = performance.now()
  sendRaw({ type: 'ping', t: Date.now() })
  pingIntervalId = window.setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const now = performance.now()
    const interval = inMatch ? 4000 : 8000
    if (now - lastPingSentAt >= interval - 50) {
      lastPingSentAt = now
      sendRaw({ type: 'ping', t: Date.now() })
    }
  }, 4000)
}

function stopPingTimer() {
  if (pingIntervalId) {
    clearInterval(pingIntervalId)
    pingIntervalId = 0
  }
}

export function ensureConnected(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
  if (connectPromise) return connectPromise

  connecting = true
  error = null
  emitUi(true)

  connectPromise = new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl())
    ws = socket

    socket.onopen = () => {
      connected = true
      connecting = false
      error = null
      connectPromise = null
      flushQueue()
      startPingTimer()
      emitUi(true)
      resolve()
    }

    socket.onerror = () => {
      connecting = false
      sendQueue.length = 0
      error = 'Çok oyunculu sunucusuna bağlanılamadı.'
      connectPromise = null
      emitUi(true)
      reject(new Error(error))
    }

    socket.onclose = () => {
      const wasInMatch = inMatch
      const hadRoom = !!room
      stopPingTimer()
      ws = null
      connected = false
      connecting = false
      pingMs = null
      connectPromise = null
      sendQueue.length = 0
      if (wasInMatch || hadRoom) {
        stopLoops()
        clearPendingOptimistic()
        inMatch = false
        room = null
        isHost = false
        hostSim = null
        clientSim = null
        peerControls.clear()
        pendingHostEvents = []
        error = 'Sunucu bağlantısı kesildi.'
      }
      emitUi(true)
    }

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage
        handleServerMessage(msg)
      } catch {
        /* geçersiz paket yoksay */
      }
    }
  })

  return connectPromise
}

function createEmptySim(gs: GameState): Sim {
  return {
    gs,
    warpIdx: 0,
    warpRampTimer: 0,
    firing: new Map(),
    fx: [],
    clock: 0,
  }
}

function startHostMatch(joinedRoom: RoomSnapshot) {
  if (!you) return
  const gs = newMultiplayerGame(
    joinedRoom.code,
    joinedRoom.hostId,
    joinedRoom.players.map((p) => ({ id: p.id, username: p.username, color: p.color, slot: p.slot })),
    joinedRoom.config,
  )
  gs.ownerId = you.id
  gs.targetBody = gs.mp?.players[you.id]?.targetBody ?? 'moon'
  gs.design = localDesign.map((p) => ({ ...p }))
  gs.designCargo = { ...localDesignCargo }
  hostSim = createEmptySim(gs)
  clientSim = null
  peerControls.clear()
  pendingHostEvents = []
  lastSnapshotSentAt = 0
  lastStaticSentAt = 0
  staticDirty = true
  forceImmediateSnapshot = true
  urgentSnapshot = true
  clearPendingOptimistic()
  inMatch = true
  active = true
  startLoops()
  sendHostSnapshot(performance.now())
  emitUi(true)
}

export function buildCompactSnapshot(sim: Sim, includeStatic: boolean): SnapshotWire {
  const gs = sim.gs
  const clock = sim.clock ?? 0
  if (sim.fx?.length) {
    sim.fx = sim.fx.filter((f) => clock - f.born < (f.kind === 'beam' || f.kind === 'hit' || f.kind === 'shield' || f.kind === 'muzzle' ? 0.65 : 3.5))
  }
  const fxList = (sim.fx ?? []).slice(-24)

  let mpOut = gs.mp
  if (gs.mp) {
    const slimProj: Projectile[] | undefined = gs.mp.projectiles?.map((pr) => ({
      ...pr,
      pos: { x: r2(pr.pos.x), y: r2(pr.pos.y) },
      vel: { x: r2(pr.vel.x), y: r2(pr.vel.y) },
    }))
    if (!includeStatic) {
      const slimPlayers: typeof gs.mp.players = {}
      for (const [pid, p] of Object.entries(gs.mp.players)) {
        const { earthBase: _omitBase, colonies: _omitCols, ...rest } = p
        slimPlayers[pid] = rest
      }
      mpOut = {
        ...gs.mp,
        players: slimPlayers,
        feed: gs.mp.feed.slice(-14),
        ...(slimProj ? { projectiles: slimProj } : {}),
      }
    } else if (slimProj) {
      mpOut = {
        ...gs.mp,
        projectiles: slimProj,
      }
    }
  }

  return {
    time: gs.time,
    tick: gs.tick,
    protocolVersion: gs.protocolVersion,
    ownerId: gs.ownerId,
    mp: mpOut,
    money: gs.money,
    vessels: gs.vessels.map((v) => {
      let tracked = sentPartsKey.get(sim)
      if (!tracked) sentPartsKey.set(sim, (tracked = new Map()))
      const key = partsKey(v.parts)
      const prev = tracked.get(v.id)
      // Yapı yalnızca araç yeniyken, değişince veya 12 sn'de bir tek kare gönderilir (kuyruk şişmez).
      const needParts = !prev || prev.key !== key || clock - prev.lastFull >= 12
      if (needParts) tracked.set(v.id, { key, lastFull: clock })
      return compactVessel(v, needParts, key, clock)
    }) as unknown as Vessel[],
    activeId: gs.activeId,
    nextId: gs.nextId,
    bases: includeStatic ? gs.bases : {},
    missionsDone: [],
    techDone: [INITIAL_TECH],
    design: [],
    designCargo: {},
    targetBody: gs.targetBody,
    issDeliveries: gs.issDeliveries,
    _warpIdx: sim.warpIdx,
    _firing: [...sim.firing.entries()].map(([id, m]) => [id, [...m.entries()]]),
    _fx: fxList,
    _clock: clock,
    _omitStatic: includeStatic ? undefined : true,
    _hostPing: pingMs ?? undefined,
  }
}

const knownVesselParts = new Map<number, PartInst[]>()
const knownPartsKey = new Map<number, string>()

export function hydrateCompactSnapshot(
  raw: SnapshotWire,
  prevGs: GameState | null,
  ownId: string,
  design: PartInst[],
  designCargo: Record<string, number>,
): {
  gs: GameState
  warpIdx: number
  firing: Map<number, Map<number, number>>
  fx: Fx[]
  clock: number
  missingPartIds: number[]
} {
  const warpIdx = raw._warpIdx ?? raw.mp?.warpInfo?.warpIdx ?? 0
  const firingEntries = raw._firing ?? []
  const fx = raw._fx ?? []
  const clock = raw._clock ?? 0
  const omitStatic = !!raw._omitStatic

  const { _warpIdx: _w, _firing: _fi, _fx: _fx, _clock: _cl, _omitStatic: _os, _hostPing: _hp, ...cleanGs } = raw

  const missingPartIds: number[] = []
  // Yapısı gelmeyen araçlar önceki görüntüden tamamlanır; eksik/eskiyse host'tan tek seferlik istenir.
  const prevById = new Map((prevGs?.vessels ?? []).map((v) => [v.id, v]))
  cleanGs.vessels = (cleanGs.vessels as unknown as WireVessel[]).flatMap((wv) => {
    const { _pf, _ph, _pa, _pc, _pk, parts, ...rest } = wv
    let full = parts
    let partsMismatch = false
    if (full) {
      knownVesselParts.set(wv.id, full.map((p) => ({ ...p })))
      if (_pk) knownPartsKey.set(wv.id, _pk)
    } else {
      if (_pk && knownPartsKey.get(wv.id) !== _pk) {
        missingPartIds.push(wv.id)
        partsMismatch = true
      }
      const pv = prevById.get(wv.id)
      const cached = knownVesselParts.get(wv.id)
      if (pv) full = pv.parts.map((p) => ({ ...p }))
      else if (cached) full = cached.map((p) => ({ ...p }))
      else {
        missingPartIds.push(wv.id)
        return []
      }
    }
    if (!partsMismatch) {
      if (_pf) for (const [i, f] of _pf) if (full[i]) full[i].fuel = f
      if (_ph) for (const [i, h] of _ph) if (full[i]) full[i].hp = h
      if (_pa) for (const [i, a] of _pa) if (full[i]) full[i].ammo = a
    }
    if (!parts) {
      for (const pt of full) {
        pt.charge = 0
        pt.cd = 0
        pt.beamUntil = 0
      }
    }
    if (_pc && !partsMismatch) {
      for (const [i, ch, beamRem, fireOrCd, explicitCd] of _pc) {
        const pt = full[i]
        if (!pt) continue
        pt.charge = ch
        pt.beamUntil = beamRem > 0 ? clock + beamRem : 0
        if (fireOrCd >= 0) pt.fireAt = clock - fireOrCd
        else if (explicitCd === undefined) pt.cd = -fireOrCd
        if (explicitCd !== undefined) pt.cd = explicitCd
      }
    }
    return [{ ...rest, parts: full } as Vessel]
  })

  if (omitStatic && prevGs) {
    cleanGs.bases = prevGs.bases
    if (cleanGs.mp && prevGs.mp) {
      const restored: typeof cleanGs.mp.players = {}
      for (const [pid, p] of Object.entries(cleanGs.mp.players)) {
        const prevP = prevGs.mp.players[pid]
        const earthBase = p.earthBase ?? prevP?.earthBase
        const colonies = p.colonies ?? prevP?.colonies
        restored[pid] = {
          ...p,
          ...(earthBase ? { earthBase } : {}),
          ...(colonies ? { colonies } : {}),
        }
      }
      cleanGs.mp = { ...cleanGs.mp, players: restored }
    }
  }

  cleanGs.ownerId = ownId
  const me = cleanGs.mp?.players[ownId]
  if (me) {
    cleanGs.money = me.money
    cleanGs.activeId = me.activeVesselId
    cleanGs.targetBody = me.targetBody
  } else {
    cleanGs.activeId = null
  }
  cleanGs.design = design.map((p) => ({ ...p }))
  cleanGs.designCargo = { ...designCargo }

  return {
    gs: cleanGs,
    warpIdx,
    firing: new Map(firingEntries.map(([id, pairs]) => [id, new Map(pairs)])),
    fx,
    clock,
    missingPartIds,
  }
}

function sendHostSnapshot(now: number) {
  if (!isHost || !hostSim) return
  if (!forceImmediateSnapshot && now - lastSnapshotSentAt < 20) return
  if (!forceImmediateSnapshot && ws && ws.bufferedAmount > 24 * 1024) {
    urgentSnapshot = false
    return
  }
  lastSnapshotSentAt = now
  urgentSnapshot = false
  forceImmediateSnapshot = false

  const includeStatic = staticDirty || now - lastStaticSentAt >= 12000
  if (includeStatic) {
    staticDirty = false
    lastStaticSentAt = now
  }

  const payload = buildCompactSnapshot(hostSim, includeStatic)
  const evs = pendingHostEvents.filter(
    (e) =>
      e.type === 'capture' ||
      e.type === 'colonyDestroyed' ||
      e.type === 'kill' ||
      e.type === 'victory' ||
      e.type === 'crash' ||
      e.type === 'explosion' ||
      e.type === 'weaponFire' ||
      e.type === 'shieldHit' ||
      (e.type === 'toast' && !!e.ownerId),
  )
  pendingHostEvents = []
  sendRaw({ type: 'hostSnapshot', state: payload, events: evs })
}

function ownActive(gs: GameState | null | undefined): Vessel | null {
  if (!gs || !you) return null
  const v = gs.vessels.find((o) => o.id === gs.activeId && o.ownerId === you!.id)
  return v ?? null
}

/** İyimser yerel değişikliklerin, ev sahibinin onayı gelene kadar korunacağı süre (ms): pinge göre büyür. */
function pendWindow(): number {
  return Math.max(300, (pingMs ?? 80) * 2 + lastHostPing + 200)
}

/** İstemci ile ev sahibi arasındaki tek yön gecikme tahmini (s). */
function latencySec(): number {
  return Math.max(0, Math.min(0.4, ((pingMs ?? 80) + lastHostPing) / 2 / 1000))
}

/** Kendi aracını yerel tuşlarla fizik adımında ilerletir (itki, dönüş, yerçekimi, iniş). */
function predictOwn(v: Vessel, simDt: number, warp: number, writeFiring = false) {
  if (simDt <= 0) return
  const n = Math.min(400, Math.max(1, Math.ceil(simDt / 0.02)))
  const h = simDt / n
  for (let i = 0; i < n; i += 1) {
    const res = stepPhysics(v, h, localCtrl, 1 / Math.max(1, warp), null)
    if (writeFiring && clientSim) clientSim.firing.set(v.id, res.firing)
    if (res.crash || res.touchdown) break
  }
}

function applyClientSnapshot(raw: SnapshotWire, events?: GameEvent[]) {
  if (!you || !inMatch || !room) return
  const prevGs = clientSim?.gs ?? null
  const prevVis = new Map<number, { bodyId: string; x: number; y: number }>()
  if (prevGs && clientSim) {
    for (const o of prevGs.vessels) {
      const vp = getVisualPos(o)
      prevVis.set(o.id, { bodyId: o.bodyId, x: vp.x, y: vp.y })
    }
  }
  if (typeof raw._hostPing === 'number') lastHostPing = raw._hostPing
  const predV = ownActive(prevGs)
  const pred = predV
    ? { id: predV.id, bodyId: predV.bodyId, pos: { ...predV.pos }, vel: { ...predV.vel }, angle: predV.angle, angVel: predV.angVel, landed: predV.landed }
    : null
  const hydrated = hydrateCompactSnapshot(raw, prevGs, you.id, localDesign, localDesignCargo)
  const gs = hydrated.gs
  const now = Date.now()
  const warpNow = WARPS[hydrated.warpIdx] ?? 1

  if (pendingLaunchUntil > 0) {
    const spawned = gs.vessels.some((v) => v.ownerId === you!.id && v.id > pendingLaunchMinId)
    const rejected = events?.some((e) => e.type === 'toast' && (!('ownerId' in e) || e.ownerId === you!.id))
    if (spawned || rejected || now >= pendingLaunchUntil) {
      pendingLaunchUntil = 0
      pendingLaunchMinId = 0
    }
  }

  if (pendingTarget && gs.mp?.players[you.id]) {
    const me = gs.mp.players[you.id]!
    if (me.targetBody === pendingTarget.bodyId || now >= pendingTarget.until) {
      pendingTarget = null
    } else {
      me.targetBody = pendingTarget.bodyId
      gs.targetBody = pendingTarget.bodyId
      const av = ownActive(gs)
      if (av) av.targetBody = pendingTarget.bodyId
    }
  }

  if (pendingWarpPref && gs.mp?.players[you.id]) {
    const me = gs.mp.players[you.id]!
    const matched = me.wantsWarpIdx === pendingWarpPref.warpIdx && (pendingWarpPref.anchor === undefined || me.warpAnchor === pendingWarpPref.anchor)
    if (matched || now >= pendingWarpPref.until) {
      pendingWarpPref = null
    } else {
      me.wantsWarpIdx = pendingWarpPref.warpIdx
      if (pendingWarpPref.anchor !== undefined) me.warpAnchor = pendingWarpPref.anchor
    }
  }

  if (pendingActive) {
    const targetExists = gs.vessels.some((v) => v.id === pendingActive!.vesselId && v.ownerId === you!.id)
    if (!targetExists || gs.activeId === pendingActive.vesselId || now >= pendingActive.until) {
      pendingActive = null
    } else {
      gs.activeId = pendingActive.vesselId
    }
  }

  if (pendingThrottle) {
    const v = gs.vessels.find((o) => o.id === pendingThrottle!.vesselId && o.ownerId === you!.id)
    if (!v || Math.abs(v.throttle - pendingThrottle.value) <= 0.025 || now >= pendingThrottle.until) {
      pendingThrottle = null
    } else {
      v.throttle = pendingThrottle.value
    }
  }

  if (pendingAutopilot) {
    const v = gs.vessels.find((o) => o.id === pendingAutopilot!.vesselId && o.ownerId === you!.id)
    const curMode = v ? effectiveAutopilot(v) : 'off'
    if (!v || curMode === pendingAutopilot.mode || now >= pendingAutopilot.until) {
      pendingAutopilot = null
    } else {
      v.autopilot = pendingAutopilot.mode
      v.autoLand = pendingAutopilot.mode === 'land'
    }
  }

  // Kendi aracında uzlaştırma: yakıt/EC tüketmeden gecikme kadar ileri sar ve yumuşat.
  const nv = pred ? ownActive(gs) : null
  if (pred && nv && !nv.cruise && nv.id === pred.id && nv.bodyId === pred.bodyId && effectiveAutopilot(nv) === 'off') {
    if (!nv.landed) {
      nv.angle = pred.angle
      nv.angVel = pred.angVel
    }
    if (localCtrl.aimAngle !== undefined) nv.aimAngle = localCtrl.aimAngle
    const liftingOff = nv.throttle > 0 || localCtrl.ty > 0 || (pendingThrottle !== null && pendingThrottle.value > 0)
    if (nv.landed && !pred.landed && liftingOff) {
      nv.angle = pred.angle
      nv.angVel = pred.angVel
      nv.landed = false
      nv.pos = pred.pos
      nv.vel = pred.vel
    } else if (!nv.landed && !pred.landed && hydrated.warpIdx <= PHYSICS_WARP_MAX_IDX) {
      const leadDt = latencySec() * warpNow
      nv.pos = { x: nv.pos.x + nv.vel.x * leadDt, y: nv.pos.y + nv.vel.y * leadDt }
    }
  } else if (nv && localCtrl.aimAngle !== undefined) {
    nv.aimAngle = localCtrl.aimAngle
  }

  // Görsel konum yumuşatması: ağ paketi geldiğinde hiçbir roket kareler arası sıçramasın.
  const aliveIds = new Set<number>()
  const maxSmooth = 1800 * Math.max(1, warpNow)
  for (const v of gs.vessels) {
    aliveIds.add(v.id)
    if (v.cruise) {
      vesselVisualOffsets.delete(v.id)
      continue
    }
    const pv = prevVis.get(v.id)
    if (!pv || pv.bodyId !== v.bodyId) {
      vesselVisualOffsets.delete(v.id)
      continue
    }
    const ox = pv.x - v.pos.x
    const oy = pv.y - v.pos.y
    const dist = Math.hypot(ox, oy)
    if (dist > 0.01 && dist < maxSmooth) {
      vesselVisualOffsets.set(v.id, { bodyId: v.bodyId, x: ox, y: oy })
    } else {
      vesselVisualOffsets.delete(v.id)
    }
  }
  for (const id of vesselVisualOffsets.keys()) {
    if (!aliveIds.has(id)) vesselVisualOffsets.delete(id)
  }

  if (hydrated.missingPartIds.length) {
    const reqNow = performance.now()
    for (const vid of hydrated.missingPartIds) {
      const lastReq = lastPartsReqAt.get(vid) ?? 0
      if (reqNow - lastReq >= 450) {
        lastPartsReqAt.set(vid, reqNow)
        sendRaw({ type: 'requestParts', vesselId: vid })
      }
    }
  }

  if (!clientSim) {
    clientSim = createEmptySim(gs)
  } else {
    clientSim.gs = gs
  }
  clientSim.warpIdx = hydrated.warpIdx
  clientSim.firing = hydrated.firing
  clientSim.fx = hydrated.fx
  clientSim.clock = hydrated.clock + (warpNow <= PHYSICS_WARP_MAX_IDX ? latencySec() : 0)
  lastClientSnapAt = performance.now()
  inMatch = true
  active = true

  if (events?.length) notifyEvents(events)
  emitUi(false)
}

function stepClientExtrapolation(dtReal: number) {
  if (!clientSim) return
  const sinceSnap = (performance.now() - lastClientSnapAt) / 1000
  if (sinceSnap > 4) return
  const atten = sinceSnap <= 1.2 ? 1 : Math.max(0.2, 1 - (sinceSnap - 1.2) / 3.0)
  const real = Math.min(0.05, Math.max(0, dtReal)) * atten
  const decay = Math.exp(-Math.min(0.05, Math.max(0, dtReal)) * 14)
  for (const [id, off] of vesselVisualOffsets) {
    off.x *= decay
    off.y *= decay
    if (Math.hypot(off.x, off.y) < 0.01) vesselVisualOffsets.delete(id)
  }

  const warpIdx = clientSim.warpIdx ?? 0
  const warp = WARPS[warpIdx] ?? 1
  const simDt = real * warp
  clientSim.clock = (clientSim.clock ?? 0) + real
  clientSim.gs.time += simDt
  const own = ownActive(clientSim.gs)
  for (const v of clientSim.gs.vessels) {
    if (!Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.y) || !Number.isFinite(v.vel.x) || !Number.isFinite(v.vel.y)) continue
    // Hızlı yolculuk ev sahibiyle aynı formülle yerelde de akar.
    if (v.cruise) {
      stepCruise(clientSim.gs, clientSim.clock ?? 0, v)
      continue
    }
    const ap = effectiveAutopilot(v)
    // Kendi aracın: yerel tuşlarla tam fizik tahmini (anında tepki).
    if (v === own && ap === 'off' && (warpIdx <= PHYSICS_WARP_MAX_IDX || v.throttle > 0 || localCtrl.rotate !== 0 || localCtrl.tx !== 0 || localCtrl.ty !== 0)) {
      const effWarp = Math.min(warp, WARPS[PHYSICS_WARP_MAX_IDX] ?? 10)
      predictOwn(v, Math.min(simDt, real * effWarp), effWarp, true)
      continue
    }
    if (v.landed) continue
    if (warpIdx <= PHYSICS_WARP_MAX_IDX || v.throttle > 0 || ap === 'land') {
      const effWarp = Math.min(warp, WARPS[PHYSICS_WARP_MAX_IDX] ?? 25)
      const effDt = Math.min(simDt, real * effWarp, 1.35)
      if (v.throttle > 0 || ap !== 'off') {
        const n = Math.min(70, Math.max(1, Math.ceil(effDt / 0.02)))
        const h = effDt / n
        for (let i = 0; i < n; i += 1) {
          const res = stepPhysics(v, h, null, 1 / Math.max(1, effWarp), ap === 'transfer' ? v.angle : null)
          clientSim.firing.set(v.id, res.firing)
          if (res.crash || res.touchdown) break
        }
      } else {
        const n = Math.min(24, Math.max(1, Math.ceil(effDt / 0.04)))
        const h = effDt / n
        const body = BODIES[v.bodyId]
        for (let i = 0; i < n; i += 1) {
          const r = Math.hypot(v.pos.x, v.pos.y)
          if (body && r > 1) {
            const gFactor = -(body.mu / (r * r * r))
            v.vel = {
              x: v.vel.x + v.pos.x * gFactor * h,
              y: v.vel.y + v.pos.y * gFactor * h,
            }
          }
          v.pos = { x: v.pos.x + v.vel.x * h, y: v.pos.y + v.vel.y * h }
          v.angle = wrapPi(v.angle + v.angVel * h)
        }
      }
    } else {
      stepRails(v, Math.min(simDt, 1800))
    }
  }

  const projs = clientSim.gs.mp?.projectiles
  if (projs?.length) {
    const curClock = clientSim.clock ?? 0
    for (const pr of projs) {
      if (pr.ttl <= 0 || curClock - pr.born >= pr.ttl) continue
      const pBody = BODIES[pr.bodyId]
      const gScale = pr.gravityScale ?? 1
      if (gScale !== 0 && pBody) {
        const r = Math.hypot(pr.pos.x, pr.pos.y)
        if (r > 1) {
          const gFactor = -(pBody.mu / (r * r * r)) * gScale
          pr.vel = { x: pr.vel.x + pr.pos.x * gFactor * simDt, y: pr.vel.y + pr.pos.y * gFactor * simDt }
        }
      }
      pr.pos = { x: pr.pos.x + pr.vel.x * simDt, y: pr.pos.y + pr.vel.y * simDt }
    }
  }
}

function tickLoop(now: number) {
  if (!inMatch) return
  // Ev sahibi geride kaldıysa (sekme arka planda, kısa takılma) aradaki süre alt adımlarla telafi edilir;
  // yoksa oyun herkes için yavaşlar ve oyuncular olduğu yerde kalmış gibi görünür.
  const totalDt = lastLoopAt > 0 ? Math.min(isHost ? 1.5 : 0.25, Math.max(0.001, (now - lastLoopAt) / 1000)) : 0.016
  lastLoopAt = now

  if (isHost && hostSim) {
    let rem = totalDt
    while (rem > 0.0001) {
      const sub = Math.min(0.025, rem)
      rem -= sub
      const events = stepWorld(hostSim, sub, peerControls)
      if (events.length) {
        pendingHostEvents.push(...events)
        notifyEvents(events)
        if (events.some((e) => e.type === 'capture' || e.type === 'colonyDestroyed')) staticDirty = true
        if (
          events.some(
            (e) =>
              e.type === 'capture' ||
              e.type === 'colonyDestroyed' ||
              e.type === 'kill' ||
              e.type === 'victory' ||
              e.type === 'crash' ||
              e.type === 'weaponFire',
          )
        ) {
          urgentSnapshot = true
          if (events.some((e) => e.type === 'victory' || e.type === 'colonyDestroyed')) forceImmediateSnapshot = true
        }
      }
    }
    if (hostSim.colonyDirty) {
      staticDirty = true
      urgentSnapshot = true
      hostSim.colonyDirty = false
    }
    if (forceImmediateSnapshot || urgentSnapshot || now - lastSnapshotSentAt >= 42) {
      sendHostSnapshot(now)
    }
    emitUi(false)
  } else if (clientSim) {
    stepClientExtrapolation(Math.min(0.05, totalDt))
  }
}

function startLoops() {
  stopLoops()
  lastLoopAt = performance.now()
  const onFrame = (now: number) => {
    if (!inMatch) return
    tickLoop(now)
    rafId = requestAnimationFrame(onFrame)
  }
  rafId = requestAnimationFrame(onFrame)
  // Sekme arka plandayken Ev Sahibi fizik döngüsünün tamamen donmaması için yedek zamanlayıcı
  bgIntervalId = window.setInterval(() => {
    if (!inMatch || !isHost) return
    const now = performance.now()
    if (now - lastLoopAt >= 75) tickLoop(now)
  }, 80)
  // Tarayıcılar arka plandaki sekmenin zamanlayıcılarını saniyede 1'e düşürür; Web Worker zamanlayıcısı
  // kısılmaz. Ev sahibi başka sekmeye/pencereye geçse bile oyun 30 Hz'te akmaya devam eder.
  try {
    const src = 'setInterval(function(){postMessage(0)},33)'
    bgWorkerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    bgWorker = new Worker(bgWorkerUrl)
    bgWorker.onmessage = () => {
      if (!inMatch || !isHost) return
      const now = performance.now()
      if (now - lastLoopAt >= 45) tickLoop(now)
    }
  } catch {
    bgWorker = null
  }
}

function stopLoops() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (bgIntervalId) {
    clearInterval(bgIntervalId)
    bgIntervalId = 0
  }
  if (bgWorker) {
    bgWorker.terminate()
    bgWorker = null
  }
  if (bgWorkerUrl) {
    URL.revokeObjectURL(bgWorkerUrl)
    bgWorkerUrl = null
  }
  lastLoopAt = 0
}

function handleServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'pong': {
      const rtt = Math.max(1, Math.round(Date.now() - msg.t))
      const nextPing = pingMs === null ? rtt : Math.round(pingMs * 0.5 + rtt * 0.5)
      const changed = pingMs === null || Math.abs(nextPing - pingMs) >= 2
      pingMs = nextPing
      if (!inMatch) emitUi(true)
      else if (changed) emitUi(false)
      return
    }
    case 'rooms':
      rooms = msg.rooms
      emitUi(true)
      return
    case 'roomJoined':
      isHost = msg.isHost
      you = msg.you
      room = msg.room
      active = true
      error = null
      chat = []
      clearPendingOptimistic()
      localDesign = (msg.room.config.mode === 'orbital-warfare' ? COMBAT_PRESETS[0].design : DEFAULT_DESIGN).map((p) => ({
        ...p,
      }))
      localDesignCargo = {}
      emitUi(true)
      return
    case 'roomState':
      room = msg.room
      emitUi(true)
      return
    case 'peerJoined':
      if (isHost && hostSim) {
        addMultiplayerPlayer(hostSim.gs, msg.player.id, msg.player.username, msg.player.color, msg.player.slot)
        sentPartsKey.delete(hostSim)
        staticDirty = true
        forceImmediateSnapshot = true
        urgentSnapshot = true
        sendHostSnapshot(performance.now())
      }
      emitUi(true)
      return
    case 'peerLeft':
      if (isHost && hostSim) {
        hostSim.gs.vessels = hostSim.gs.vessels.filter(
          (v) => !(v.ownerId === msg.playerId && v.bodyId === 'earth' && v.landed),
        )
        const leaving = hostSim.gs.mp?.players[msg.playerId]
        if (isWarfareMode(hostSim.gs) && hostSim.gs.mp?.started && (hostSim.gs.mp.config.warfareGoal ?? 'siege') === 'siege' && leaving) {
          leaving.eliminated = true
          if (leaving.earthBase) leaving.earthBase.destroyed = true
          if (leaving.colonies) {
            for (const col of Object.values(leaving.colonies)) if (col) col.destroyed = true
          }
          pushMpFeed(hostSim.gs, `${leaving.username} ayrıldı.`, leaving.color)
        } else {
          removeMultiplayerPlayer(hostSim.gs, msg.playerId)
        }
        peerControls.delete(msg.playerId)
        staticDirty = true
        forceImmediateSnapshot = true
        urgentSnapshot = true
        sendHostSnapshot(performance.now())
      }
      emitUi(true)
      return
    case 'roomClosed':
      stopLoops()
      clearPendingOptimistic()
      inMatch = false
      room = null
      isHost = false
      hostSim = null
      clientSim = null
      peerControls.clear()
      pendingHostEvents = []
      chat = []
      lastHostPing = 0
      error = msg.reason || 'Oda kapatıldı.'
      emitUi(true)
      return
    case 'leftRoom':
      stopLoops()
      clearPendingOptimistic()
      inMatch = false
      room = null
      isHost = false
      hostSim = null
      clientSim = null
      peerControls.clear()
      pendingHostEvents = []
      chat = []
      lastHostPing = 0
      emitUi(true)
      return
    case 'matchStarted':
      room = msg.room
      chat = []
      clearPendingOptimistic()
      if (isHost) {
        startHostMatch(msg.room)
      } else {
        inMatch = true
        active = true
        startLoops()
        emitUi(true)
      }
      return
    case 'peerCmd':
      if (isHost && hostSim) {
        if (STATIC_DIRTY_CMDS.has(msg.cmd.type)) staticDirty = true
        const res = dispatchCommand(hostSim, msg.cmd, msg.fromId)
        if (res.events.length) {
          pendingHostEvents.push(...res.events)
          notifyEvents(res.events)
        }
        if (res.error) {
          pendingHostEvents.push({ type: 'toast', ownerId: msg.fromId, text: res.error })
        }
        if (msg.cmd.type === 'launch' && !res.error) {
          forceImmediateSnapshot = true
        }
        urgentSnapshot = true
        sendHostSnapshot(performance.now())
        emitUi(true)
      }
      return
    case 'peerCtrl':
      if (isHost) {
        peerControls.set(msg.fromId, msg.ctrl)
      }
      return
    case 'requestParts':
      if (isHost && hostSim) {
        sentPartsKey.get(hostSim)?.delete(msg.vesselId)
        urgentSnapshot = true
      }
      return
    case 'snapshot':
      if (!isHost) {
        applyClientSnapshot(msg.state, msg.events)
      }
      return
    case 'chat':
      chat = [
        ...chat.slice(-29),
        {
          id: chatNextId++,
          fromId: msg.fromId,
          username: msg.username,
          color: msg.color,
          text: msg.text,
          time: Date.now(),
        },
      ]
      emitUi(true)
      return
    case 'error':
      error = msg.message
      notifyEvents([{ type: 'toast', text: msg.message }])
      emitUi(true)
      return
  }
}

export async function refreshRooms() {
  await ensureConnected()
  sendRaw({ type: 'listRooms' })
}

export async function createRoom(username: string, roomName: string, config: Partial<MultiplayerConfig>) {
  await ensureConnected()
  error = null
  active = true
  sendRaw({ type: 'createRoom', username, roomName, config })
}

export async function joinRoom(code: string, username: string) {
  await ensureConnected()
  error = null
  active = true
  sendRaw({ type: 'joinRoom', code: code.trim().toUpperCase(), username })
}

export function startMpMatch() {
  if (!room || !isHost) return
  sendRaw({ type: 'startMatch' })
}

export function leaveMpRoom(exitMode = false) {
  stopLoops()
  clearPendingOptimistic()
  if (ws && ws.readyState === WebSocket.OPEN && room) {
    ws.send(JSON.stringify({ type: 'leaveRoom' }))
  }
  room = null
  isHost = false
  inMatch = false
  hostSim = null
  clientSim = null
  peerControls.clear()
  pendingHostEvents = []
  chat = []
  lastHostPing = 0
  error = null
  if (exitMode) active = false
  emitUi(true)
}

export function enterMpMode() {
  active = true
  emitUi(true)
  void refreshRooms().catch(() => {})
}

export function exitMpMode() {
  leaveMpRoom(true)
}

export function sendMpChat(text: string) {
  if (!room || !text.trim()) return
  sendRaw({ type: 'chat', text: text.trim().slice(0, 140) })
}

export function sendMpControls(ctrl: Controls) {
  if (!inMatch || !you) return
  if (isHost) {
    peerControls.set(you.id, { ...ctrl })
    return
  }
  const now = performance.now()
  localCtrl = {
    rotate: ctrl.rotate,
    tx: ctrl.tx,
    ty: ctrl.ty,
    ...(ctrl.fire ? { fire: true } : {}),
    ...(ctrl.weaponKey ? { weaponKey: ctrl.weaponKey } : {}),
    ...(ctrl.fireGroup !== undefined ? { fireGroup: ctrl.fireGroup } : {}),
    ...(ctrl.aimAngle !== undefined ? { aimAngle: Math.round(ctrl.aimAngle * 10000) / 10000 } : {}),
    ...(ctrl.aimDist !== undefined ? { aimDist: Math.round(ctrl.aimDist) } : {}),
  }
  const own = ownActive(clientSim?.gs)
  const withAngle = own && !own.landed && effectiveAutopilot(own) === 'off'
  const changed =
    ctrl.rotate !== lastSentCtrl.rotate ||
    ctrl.tx !== lastSentCtrl.tx ||
    ctrl.ty !== lastSentCtrl.ty ||
    Boolean(ctrl.fire) !== Boolean(lastSentCtrl.fire) ||
    ctrl.weaponKey !== lastSentCtrl.weaponKey ||
    (ctrl.fireGroup ?? 0) !== (lastSentCtrl.fireGroup ?? 0)
  const activeCtrl = ctrl.rotate !== 0 || ctrl.tx !== 0 || ctrl.ty !== 0
  const aimMovedFiring =
    Boolean(ctrl.fire) &&
    ctrl.aimAngle !== undefined &&
    (lastSentCtrl.aimAngle === undefined ||
      Math.abs(wrapPi(ctrl.aimAngle - lastSentCtrl.aimAngle)) > 0.03 ||
      Math.abs((ctrl.aimDist ?? 0) - (lastSentCtrl.aimDist ?? 0)) > 35) &&
    now - lastSentCtrlAt >= 36
  const aimMovedIdle =
    !ctrl.fire &&
    ctrl.aimAngle !== undefined &&
    (lastSentCtrl.aimAngle === undefined || Math.abs(wrapPi(ctrl.aimAngle - lastSentCtrl.aimAngle)) > 0.08) &&
    now - lastSentCtrlAt >= 120
  const aimingChanged = aimMovedFiring || aimMovedIdle
  const turned = withAngle && Math.abs(wrapPi(own!.angle - lastSentAngle)) > 0.06 && now - lastSentCtrlAt >= 48
  if (changed || aimingChanged || turned || (activeCtrl && now - lastSentCtrlAt >= 42)) {
    lastSentCtrl = { ...localCtrl }
    lastSentCtrlAt = now
    const payload: Controls = withAngle
      ? { ...localCtrl, vid: own!.id, angle: Math.round(own!.angle * 10000) / 10000, angVel: Math.round(own!.angVel * 10000) / 10000 }
      : localCtrl
    if (withAngle) lastSentAngle = own!.angle
    sendRaw({ type: 'clientCtrl', ctrl: payload })
  }
}

export function sendMpCommand(cmd: GameCommand): { ok: boolean; error?: string; events?: GameEvent[] } {
  if (!inMatch || !you) return { ok: false, error: 'Çok oyunculu maç etkin değil.' }
  if (isHost && hostSim) {
    if (STATIC_DIRTY_CMDS.has(cmd.type)) staticDirty = true
    const res = dispatchCommand(hostSim, cmd, you.id)
    if (res.events.length) {
      pendingHostEvents.push(...res.events)
      notifyEvents(res.events)
    }
    if (res.error) notifyEvents([{ type: 'toast', text: res.error }])
    if (cmd.type === 'launch' && !res.error) forceImmediateSnapshot = true
    urgentSnapshot = true
    sendHostSnapshot(performance.now())
    emitUi(true)
    return { ok: !res.error, error: res.error, events: res.events }
  }
  const now = Date.now()
  if (cmd.type === 'launch') {
    const ownedIds = (clientSim?.gs.vessels ?? []).filter((v) => v.ownerId === you!.id).map((v) => v.id)
    pendingLaunchMinId = ownedIds.length ? Math.max(...ownedIds) : 0
    pendingLaunchUntil = now + 2500
    emitUi(true)
  } else if (cmd.type === 'setThrottle') {
    const clamped = Math.max(0, Math.min(1, cmd.throttle))
    pendingThrottle = { vesselId: cmd.vesselId, value: clamped, until: now + pendWindow() }
    const v = clientSim?.gs.vessels.find((o) => o.id === cmd.vesselId && o.ownerId === you!.id)
    if (v) v.throttle = clamped
  } else if (cmd.type === 'emergencyStop') {
    pendingThrottle = { vesselId: cmd.vesselId, value: 0, until: now + pendWindow() }
    const v = clientSim?.gs.vessels.find((o) => o.id === cmd.vesselId && o.ownerId === you!.id)
    if (v) {
      v.throttle = 0
      v.autopilot = 'off'
      v.autoLand = false
    }
  } else if (cmd.type === 'setActive') {
    pendingActive = { vesselId: cmd.vesselId, until: now + pendWindow() }
    if (clientSim) clientSim.gs.activeId = cmd.vesselId
  } else if (cmd.type === 'setTarget') {
    pendingTarget = { bodyId: cmd.bodyId, until: now + pendWindow() }
    if (clientSim?.gs.mp) {
      const me = clientSim.gs.mp.players[you.id]
      if (me) me.targetBody = cmd.bodyId
      clientSim.gs.targetBody = cmd.bodyId
      const av = ownActive(clientSim.gs)
      if (av) av.targetBody = cmd.bodyId
    }
  } else if (cmd.type === 'setWarpPref') {
    pendingWarpPref = { warpIdx: cmd.warpIdx, anchor: cmd.anchor, until: now + pendWindow() }
    if (clientSim?.gs.mp) {
      const me = clientSim.gs.mp.players[you.id]
      if (me) {
        me.wantsWarpIdx = cmd.warpIdx
        if (cmd.anchor !== undefined) me.warpAnchor = cmd.anchor
      }
    }
  } else if (cmd.type === 'setAutopilot') {
    pendingAutopilot = { vesselId: cmd.vesselId, mode: cmd.mode, until: now + pendWindow() }
    const v = clientSim?.gs.vessels.find((o) => o.id === cmd.vesselId && o.ownerId === you!.id)
    if (v) {
      v.autopilot = cmd.mode
      v.autoLand = cmd.mode === 'land'
    }
  }
  sendRaw({ type: 'clientCmd', cmd })
  return { ok: true }
}

export function isMpPendingLaunch(): boolean {
  return active && inMatch && !isHost && Date.now() < pendingLaunchUntil
}

export function getMpSim(): Sim | null {
  return isHost ? hostSim : clientSim
}

export function isMpMatchActive(): boolean {
  return active && inMatch && !!(isHost ? hostSim : clientSim)
}

export function isMpModeActive(): boolean {
  return active
}

export function isMpWarfareActive(): boolean {
  return active && room?.config.mode === 'orbital-warfare'
}

export function getLocalMpDesign(): { design: PartInst[]; cargo: Record<string, number> } {
  return { design: localDesign, cargo: localDesignCargo }
}

export function setLocalMpDesign(design: PartInst[], cargo: Record<string, number>) {
  localDesign = design
  localDesignCargo = cargo
  const s = getMpSim()
  if (s) {
    s.gs.design = design
    s.gs.designCargo = cargo
  }
  emitUi(true)
}

export function clearMpError() {
  error = null
  emitUi(true)
}

export function onMpEvents(cb: (events: GameEvent[]) => void): () => void {
  eventListeners.add(cb)
  return () => eventListeners.delete(cb)
}

export function useMultiplayer(): MpViewState {
  return useSyncExternalStore(
    (cb) => {
      storeListeners.add(cb)
      return () => storeListeners.delete(cb)
    },
    () => cachedView ?? rebuildView(),
  )
}

// Hata ayıklama/otomatik test için: konsoldan çok oyunculu simülasyona erişim.
if (typeof window !== 'undefined') (window as unknown as { __mpSim?: () => Sim | null }).__mpSim = () => (isHost ? hostSim : clientSim)
