/**
 * Çok oyunculu ağ istemcisi ve ev sahibi (Host) otoriter simülasyon yöneticisi.
 * Host tarayıcı fiziği adım adım yürütür ve anlık durumları aktarır;
 * istemci tarayıcılar ise kareler arasında yörünge/konum ara kestirimi (dead-reckoning) yaparak akıcı 60 FPS çizer.
 */
import { useSyncExternalStore } from 'react'
import { BODIES } from '../nasa/bodies'
import { DEFAULT_DESIGN } from '../game/data'
import type {
  AutopilotMode,
  GameCommand,
  GameEvent,
  GameState,
  MultiplayerConfig,
  PartInst,
} from '../game/types'
import { INITIAL_TECH } from '../game/tech'
import { stepRails, type Controls } from './physics'
import {
  addMultiplayerPlayer,
  newMultiplayerGame,
  PHYSICS_WARP_MAX_IDX,
  removeMultiplayerPlayer,
  WARPS,
} from './multiplayerSim'
import { dispatchCommand, type Fx, type Sim, stepWorld } from './world'

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
let lastLoopAt = 0
let rafId = 0
let bgIntervalId = 0
let lastUiBumpAt = 0

let pendingLaunchUntil = 0
let pendingLaunchMinId = 0
let pendingThrottle: { vesselId: number; value: number; until: number } | null = null
let pendingActive: { vesselId: number; until: number } | null = null
let pendingAutopilot: { vesselId: number; mode: AutopilotMode; until: number } | null = null

const STATIC_DIRTY_CMDS = new Set<GameCommand['type']>([
  'buyModule',
  'placeGridModule',
  'removeGridModule',
  'deployModules',
  'loadOre',
  'refuelAtBase',
])

function wrapPi(a: number): number {
  const tau = Math.PI * 2
  return ((((a + Math.PI) % tau) + tau) % tau) - Math.PI
}

function clearPendingOptimistic() {
  pendingLaunchUntil = 0
  pendingLaunchMinId = 0
  pendingThrottle = null
  pendingActive = null
  pendingAutopilot = null
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
  if (!force && now - lastUiBumpAt < 65) return
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
  sendRaw({ type: 'ping', t: Date.now() })
  pingIntervalId = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendRaw({ type: 'ping', t: Date.now() })
    }
  }, 2000)
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
      error = 'Çok oyunculu sunucusuna bağlanılamadı.'
      connectPromise = null
      emitUi(true)
      reject(new Error(error))
    }

    socket.onclose = () => {
      const wasInMatch = inMatch
      stopPingTimer()
      ws = null
      connected = false
      connecting = false
      pingMs = null
      connectPromise = null
      if (wasInMatch) {
        stopLoops()
        clearPendingOptimistic()
        inMatch = false
        room = null
        isHost = false
        hostSim = null
        clientSim = null
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
    sim.fx = sim.fx.filter((f) => clock - f.born < 3.5)
  }
  const fxList = (sim.fx ?? []).slice(-12)

  let mpOut = gs.mp
  if (gs.mp && !includeStatic) {
    const slimPlayers: typeof gs.mp.players = {}
    for (const [pid, p] of Object.entries(gs.mp.players)) {
      const { earthBase: _omitBase, ...rest } = p
      slimPlayers[pid] = rest
    }
    mpOut = {
      ...gs.mp,
      players: slimPlayers,
      feed: gs.mp.feed.slice(-14),
    }
  }

  return {
    time: gs.time,
    tick: gs.tick,
    protocolVersion: gs.protocolVersion,
    ownerId: gs.ownerId,
    mp: mpOut,
    money: gs.money,
    vessels: gs.vessels,
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
  }
}

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
} {
  const warpIdx = raw._warpIdx ?? raw.mp?.warpInfo?.warpIdx ?? 0
  const firingEntries = raw._firing ?? []
  const fx = raw._fx ?? []
  const clock = raw._clock ?? 0
  const omitStatic = !!raw._omitStatic

  const { _warpIdx: _w, _firing: _fi, _fx: _fx, _clock: _cl, _omitStatic: _os, ...cleanGs } = raw

  if (omitStatic && prevGs) {
    cleanGs.bases = prevGs.bases
    if (cleanGs.mp && prevGs.mp) {
      const restored: typeof cleanGs.mp.players = {}
      for (const [pid, p] of Object.entries(cleanGs.mp.players)) {
        const prevBase = prevGs.mp.players[pid]?.earthBase
        restored[pid] = p.earthBase || !prevBase ? p : { ...p, earthBase: prevBase }
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
  }
}

function sendHostSnapshot(now: number) {
  if (!isHost || !hostSim) return
  if (!forceImmediateSnapshot && now - lastSnapshotSentAt < 22) return
  if (!forceImmediateSnapshot && ws && ws.bufferedAmount > 96 * 1024) {
    urgentSnapshot = false
    return
  }
  lastSnapshotSentAt = now
  urgentSnapshot = false
  forceImmediateSnapshot = false

  const includeStatic = staticDirty || now - lastStaticSentAt >= 2500
  if (includeStatic) {
    staticDirty = false
    lastStaticSentAt = now
  }

  const payload = buildCompactSnapshot(hostSim, includeStatic)
  const evs = pendingHostEvents.filter(
    (e) =>
      e.type === 'capture' ||
      e.type === 'kill' ||
      e.type === 'victory' ||
      e.type === 'crash' ||
      e.type === 'explosion' ||
      (e.type === 'toast' && !!e.ownerId),
  )
  pendingHostEvents = []
  sendRaw({ type: 'hostSnapshot', state: payload, events: evs })
}

function applyClientSnapshot(raw: SnapshotWire, events?: GameEvent[]) {
  if (!you) return
  const prevGs = clientSim?.gs ?? null
  const hydrated = hydrateCompactSnapshot(raw, prevGs, you.id, localDesign, localDesignCargo)
  const gs = hydrated.gs
  const now = Date.now()

  if (pendingLaunchUntil > 0) {
    const spawned = gs.vessels.some((v) => v.ownerId === you!.id && v.id > pendingLaunchMinId)
    if (spawned || now >= pendingLaunchUntil) {
      pendingLaunchUntil = 0
      pendingLaunchMinId = 0
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
    const curMode = v?.autopilot ?? 'off'
    if (!v || curMode === pendingAutopilot.mode || now >= pendingAutopilot.until) {
      pendingAutopilot = null
    } else {
      v.autopilot = pendingAutopilot.mode
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
  clientSim.clock = hydrated.clock
  lastClientSnapAt = performance.now()
  inMatch = true
  active = true

  if (events?.length) notifyEvents(events)
  emitUi(false)
}

function stepClientExtrapolation(dtReal: number) {
  if (!clientSim) return
  const sinceSnap = (performance.now() - lastClientSnapAt) / 1000
  if (sinceSnap > 0.3) return
  const real = Math.min(0.05, Math.max(0, dtReal))
  const warpIdx = clientSim.warpIdx ?? 0
  const warp = WARPS[warpIdx] ?? 1
  const simDt = real * warp
  clientSim.clock = (clientSim.clock ?? 0) + real
  clientSim.gs.time += simDt
  for (const v of clientSim.gs.vessels) {
    if (v.landed) continue
    if (warpIdx <= PHYSICS_WARP_MAX_IDX) {
      const body = BODIES[v.bodyId]
      const r = Math.hypot(v.pos.x, v.pos.y)
      if (body && r > 1) {
        const gFactor = -(body.mu / (r * r * r))
        v.vel = {
          x: v.vel.x + v.pos.x * gFactor * simDt,
          y: v.vel.y + v.pos.y * gFactor * simDt,
        }
      }
      v.pos = { x: v.pos.x + v.vel.x * simDt, y: v.pos.y + v.vel.y * simDt }
      v.angle = wrapPi(v.angle + v.angVel * simDt)
    } else {
      stepRails(v, Math.min(simDt, 1800))
    }
  }
}

function tickLoop(now: number) {
  if (!inMatch) return
  const totalDt = lastLoopAt > 0 ? Math.min(0.25, Math.max(0.001, (now - lastLoopAt) / 1000)) : 0.016
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
        if (events.some((e) => e.type === 'capture')) staticDirty = true
        if (
          events.some(
            (e) => e.type === 'capture' || e.type === 'kill' || e.type === 'victory' || e.type === 'crash',
          )
        ) {
          urgentSnapshot = true
          if (events.some((e) => e.type === 'victory')) forceImmediateSnapshot = true
        }
      }
    }
    if (forceImmediateSnapshot || urgentSnapshot || now - lastSnapshotSentAt >= 50) {
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
  lastLoopAt = 0
}

function handleServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'pong': {
      const rtt = Math.max(1, Math.round(Date.now() - msg.t))
      pingMs = pingMs === null ? rtt : Math.round(pingMs * 0.6 + rtt * 0.4)
      emitUi(true)
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
      localDesign = DEFAULT_DESIGN.map((p) => ({ ...p }))
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
        removeMultiplayerPlayer(hostSim.gs, msg.playerId)
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
  const changed =
    ctrl.rotate !== lastSentCtrl.rotate || ctrl.tx !== lastSentCtrl.tx || ctrl.ty !== lastSentCtrl.ty
  const activeCtrl = ctrl.rotate !== 0 || ctrl.tx !== 0 || ctrl.ty !== 0
  if (changed || (activeCtrl && now - lastSentCtrlAt >= 33)) {
    lastSentCtrl = { ...ctrl }
    lastSentCtrlAt = now
    sendRaw({ type: 'clientCtrl', ctrl })
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
    pendingThrottle = { vesselId: cmd.vesselId, value: clamped, until: now + 280 }
    const v = clientSim?.gs.vessels.find((o) => o.id === cmd.vesselId && o.ownerId === you!.id)
    if (v) v.throttle = clamped
  } else if (cmd.type === 'emergencyStop') {
    pendingThrottle = { vesselId: cmd.vesselId, value: 0, until: now + 300 }
    const v = clientSim?.gs.vessels.find((o) => o.id === cmd.vesselId && o.ownerId === you!.id)
    if (v) {
      v.throttle = 0
      v.autopilot = 'off'
      v.autoLand = false
    }
  } else if (cmd.type === 'setActive') {
    pendingActive = { vesselId: cmd.vesselId, until: now + 300 }
    if (clientSim) clientSim.gs.activeId = cmd.vesselId
  } else if (cmd.type === 'setAutopilot') {
    pendingAutopilot = { vesselId: cmd.vesselId, mode: cmd.mode, until: now + 300 }
    const v = clientSim?.gs.vessels.find((o) => o.id === cmd.vesselId && o.ownerId === you!.id)
    if (v) v.autopilot = cmd.mode
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
