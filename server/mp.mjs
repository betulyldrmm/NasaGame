/**
 * Sıfır bağımlılıklı WebSocket (RFC 6455) ve Çok Oyunculu Oda Aktarıcısı.
 * Host tarayıcı otoriter fizik simülasyonunu çalıştırır; bu sunucu odaları yönetir
 * ve komut/kontrol/snapshot paketlerini düşük gecikmeyle aktarır.
 */
import { createHash, randomBytes } from 'node:crypto'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_FRAME_BYTES = 4 * 1024 * 1024

export const PLAYER_COLORS = ['#38d9e8', '#fb7185', '#4ade80', '#fbbf24', '#c084fc', '#fb923c', '#60a5fa', '#f472b6', '#a3e635', '#f87171', '#2dd4bf', '#e879f9', '#facc15', '#818cf8', '#fda4af', '#94a3b8']

const rooms = new Map()

function makeCode() {
  for (let i = 0; i < 40; i += 1) {
    let code = ''
    for (let k = 0; k < 4; k += 1) code += CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length]
    if (!rooms.has(code)) return code
  }
  return randomBytes(3).toString('hex').toUpperCase()
}

function encodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length
  let header
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x80 | opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payloadBuf])
}

function sendWs(client, obj) {
  if (!client || client.closed || client.socket.destroyed || !client.socket.writable) return
  try {
    const data = Buffer.from(JSON.stringify(obj), 'utf8')
    client.socket.write(encodeFrame(0x1, data))
  } catch {
    closeClient(client)
  }
}

function closeClient(client) {
  if (!client || client.closed) return
  client.closed = true
  leaveRoom(client)
  try {
    if (!client.socket.destroyed && client.socket.writable) {
      client.socket.write(encodeFrame(0x8, Buffer.alloc(0)))
    }
    client.socket.destroy()
  } catch {
    /* yoksay */
  }
}

function serializeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    hostName: room.hostName,
    started: room.started,
    config: room.config,
    players: room.members.map((m) => ({
      id: m.playerId,
      username: m.username,
      color: m.color,
      slot: m.slot,
      isHost: m === room.host,
    })),
  }
}

export function listPublicRooms() {
  const out = []
  for (const room of rooms.values()) {
    out.push({
      code: room.code,
      name: room.name,
      hostName: room.hostName,
      started: room.started,
      playerCount: room.members.length,
      maxPlayers: 16,
      config: room.config,
    })
  }
  return out.sort((a, b) => Number(a.started) - Number(b.started))
}

// Yavaş bağlantıda anlık görüntüler kuyrukta birikip saniyelerce gecikmesin: tampon dolunca
// yalnızca EN SON görüntü saklanır ve soket boşalınca gönderilir (eski kareler atılır).
const SNAPSHOT_BACKPRESSURE_BYTES = 24 * 1024

function broadcastRoom(room, obj, exceptClient = null, dropIfBacklogged = false) {
  let frame = null
  const isImportant = !dropIfBacklogged
  for (const m of room.members) {
    if (m === exceptClient) continue
    if (!m || m.closed || m.socket.destroyed || !m.socket.writable) continue
    if (!frame) frame = encodeFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'))
    if (dropIfBacklogged && m.socket.writableLength > SNAPSHOT_BACKPRESSURE_BYTES) {
      if (!m.pendingImportant) m.pendingSnap = frame
      continue
    }
    if (!isImportant && m.pendingImportant && m.socket.writableLength > SNAPSHOT_BACKPRESSURE_BYTES * 0.5) {
      continue
    }
    m.pendingSnap = null
    m.pendingImportant = false
    try {
      m.socket.write(frame)
    } catch {
      closeClient(m)
    }
  }
}

function sanitizeName(raw, fallback = 'Pilot') {
  const clean = (typeof raw === 'string' ? raw : '').trim().replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20) || fallback
  if (clean === '__proto__' || clean === 'constructor' || clean === 'prototype') return fallback
  return clean
}

function uniqueUsername(room, desired) {
  const clean = sanitizeName(desired, 'Pilot')
  const used = new Set(room.members.map((m) => m.playerId.toLowerCase()))
  if (!used.has(clean.toLowerCase())) return clean
  for (let i = 2; i < 99; i += 1) {
    const cand = `${clean.slice(0, 16)}-${i}`
    if (!used.has(cand.toLowerCase())) return cand
  }
  return `${clean.slice(0, 12)}-${randomBytes(2).toString('hex')}`
}

function nextFreeSlot(room) {
  const used = new Set(room.members.map((m) => m.slot))
  for (let s = 0; s < 16; s += 1) if (!used.has(s)) return s
  return room.members.length
}

function leaveRoom(client) {
  const code = client.roomCode
  if (!code) return
  client.roomCode = null
  const room = rooms.get(code)
  if (!room) return

  if (room.host === client) {
    rooms.delete(code)
    broadcastRoom(room, { type: 'roomClosed', reason: 'Ev sahibi ayrıldığı için oda kapandı.' }, client)
    for (const m of room.members) {
      if (m !== client) m.roomCode = null
    }
    return
  }

  room.members = room.members.filter((m) => m !== client)
  const snap = serializeRoom(room)
  broadcastRoom(room, { type: 'roomState', room: snap })
  sendWs(room.host, { type: 'peerLeft', playerId: client.playerId })
}

function handleMessage(client, msg) {
  if (!msg || typeof msg !== 'object') return
  switch (msg.type) {
    case 'ping': {
      sendWs(client, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : Date.now() })
      return
    }
    case 'listRooms': {
      sendWs(client, { type: 'rooms', rooms: listPublicRooms() })
      return
    }
    case 'createRoom': {
      leaveRoom(client)
      const code = makeCode()
      const mode = ['orbital-warfare', 'loot-raid'].includes(msg.config?.mode) ? msg.config.mode : 'colony-race'
      const warfareGoal = ['siege', 'score15', 'score30', 'endless', 'raid'].includes(msg.config?.warfareGoal)
        ? msg.config.warfareGoal
        : mode === 'loot-raid' ? 'raid' : 'siege'
      const isRaid = mode === 'loot-raid' || (mode === 'orbital-warfare' && warfareGoal === 'raid')
      const cfg = {
        mode,
        warfareGoal,
        lootGoal: [0, 30, 60, 120].includes(Number(msg.config?.lootGoal)) ? Number(msg.config.lootGoal) : 60,
        targetPlanets: [0, 3, 4, 5, 7].includes(Number(msg.config?.targetPlanets)) ? Number(msg.config.targetPlanets) : 4,
        startingMoney: Math.max(20_000, Math.min(500_000, Number(msg.config?.startingMoney) || (isRaid ? 45_000 : mode === 'orbital-warfare' ? 100_000 : 50_000))),
        passiveBonusPerPlanet: 4_000,
        allowAutoWarp: msg.config?.allowAutoWarp !== false,
      }
      const username = sanitizeName(msg.username, 'Host')
      const defaultRoomName = isRaid ? `${username} Yağma Odası` : mode === 'orbital-warfare' ? `${username} Savaş Odası` : `${username} Fetih Odası`
      const roomName = typeof msg.roomName === 'string' && msg.roomName.trim() ? msg.roomName.trim().slice(0, 32) : defaultRoomName
      client.playerId = username
      client.username = username
      client.slot = 0
      client.color = PLAYER_COLORS[0]
      client.roomCode = code
      const room = {
        code,
        name: roomName,
        host: client,
        hostId: client.playerId,
        hostName: username,
        started: false,
        config: cfg,
        members: [client],
      }
      rooms.set(code, room)
      sendWs(client, {
        type: 'roomJoined',
        isHost: true,
        you: { id: client.playerId, username: client.username, color: client.color, slot: client.slot },
        room: serializeRoom(room),
      })
      return
    }
    case 'joinRoom': {
      leaveRoom(client)
      const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : ''
      const room = rooms.get(code)
      if (!room) {
        sendWs(client, { type: 'error', message: `Oda bulunamadı: ${code || '?'}` })
        return
      }
      if (room.started) {
        sendWs(client, { type: 'error', message: 'Maç zaten başlamış; lütfen bekleyen bir odaya katıl.' })
        return
      }
      if (room.members.length >= 16) {
        sendWs(client, { type: 'error', message: 'Oda dolu (en fazla 16 oyuncu).' })
        return
      }
      const username = uniqueUsername(room, typeof msg.username === 'string' ? msg.username : 'Pilot')
      const slot = nextFreeSlot(room)
      client.playerId = username
      client.username = username
      client.slot = slot
      client.color = PLAYER_COLORS[slot % PLAYER_COLORS.length]
      client.roomCode = room.code
      room.members.push(client)
      const roomSnap = serializeRoom(room)
      sendWs(client, {
        type: 'roomJoined',
        isHost: false,
        you: { id: client.playerId, username: client.username, color: client.color, slot: client.slot },
        room: roomSnap,
      })
      broadcastRoom(room, { type: 'roomState', room: roomSnap }, client)
      sendWs(room.host, {
        type: 'peerJoined',
        player: { id: client.playerId, username: client.username, color: client.color, slot: client.slot },
      })
      return
    }
    case 'leaveRoom': {
      leaveRoom(client)
      sendWs(client, { type: 'leftRoom' })
      return
    }
    case 'startMatch': {
      const room = client.roomCode ? rooms.get(client.roomCode) : null
      if (!room || room.host !== client || room.started) return
      room.started = true
      const snap = serializeRoom(room)
      broadcastRoom(room, { type: 'matchStarted', room: snap })
      return
    }
    case 'clientCmd': {
      const room = client.roomCode ? rooms.get(client.roomCode) : null
      if (!room || !room.started || !msg.cmd || typeof msg.cmd !== 'object' || typeof msg.cmd.type !== 'string') return
      sendWs(room.host, { type: 'peerCmd', fromId: client.playerId, cmd: msg.cmd })
      return
    }
    case 'clientCtrl': {
      const room = client.roomCode ? rooms.get(client.roomCode) : null
      const c = msg.ctrl
      if (
        !room ||
        !room.started ||
        !c ||
        typeof c !== 'object' ||
        !Number.isFinite(c.rotate) ||
        !Number.isFinite(c.tx) ||
        !Number.isFinite(c.ty)
      ) {
        return
      }
      sendWs(room.host, { type: 'peerCtrl', fromId: client.playerId, ctrl: c })
      return
    }
    case 'requestParts': {
      const room = client.roomCode ? rooms.get(client.roomCode) : null
      if (!room || !room.started || room.host === client) return
      sendWs(room.host, { type: 'requestParts', vesselId: msg.vesselId })
      return
    }
    case 'hostSnapshot': {
      const room = client.roomCode ? rooms.get(client.roomCode) : null
      if (!room || room.host !== client) return
      const important = Array.isArray(msg.events) && msg.events.length > 0
      broadcastRoom(room, { type: 'snapshot', state: msg.state, events: msg.events }, client, !important)
      return
    }
    case 'chat': {
      const room = client.roomCode ? rooms.get(client.roomCode) : null
      if (!room || typeof msg.text !== 'string') return
      const text = msg.text.trim().slice(0, 140)
      if (!text) return
      broadcastRoom(room, {
        type: 'chat',
        fromId: client.playerId,
        username: client.username,
        color: client.color,
        text,
      })
      return
    }
  }
}

export function attachMultiplayerWs(server) {
  const clients = new Set()

  const pingTimer = setInterval(() => {
    for (const c of clients) {
      if (c.closed || c.socket.destroyed) {
        clients.delete(c)
        continue
      }
      try {
        c.socket.write(encodeFrame(0x9, Buffer.alloc(0)))
      } catch {
        closeClient(c)
        clients.delete(c)
      }
    }
  }, 30_000)
  pingTimer.unref?.()

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/api/mp/ws') {
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    socket.setNoDelay?.(true)
    socket.setKeepAlive?.(true, 10000)

    const client = {
      socket,
      closed: false,
      roomCode: null,
      playerId: '',
      username: '',
      slot: 0,
      color: PLAYER_COLORS[0],
      pendingSnap: null,
      pendingImportant: false,
    }
    socket.on('drain', () => {
      const f = client.pendingSnap
      if (!f || client.closed || socket.destroyed || !socket.writable) return
      client.pendingSnap = null
      client.pendingImportant = false
      try {
        socket.write(f)
      } catch {
        /* yoksay */
      }
    })
    clients.add(client)

    let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0)
    let fragChunks = []
    let fragOpcode = 0

    const pump = () => {
      while (buf.length >= 2) {
        const b0 = buf[0]
        const b1 = buf[1]
        const fin = (b0 & 0x80) !== 0
        const opcode = b0 & 0x0f
        const masked = (b1 & 0x80) !== 0
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (buf.length < 10) return
          const bigLen = buf.readBigUInt64BE(2)
          if (bigLen > BigInt(MAX_FRAME_BYTES)) {
            closeClient(client)
            return
          }
          len = Number(bigLen)
          off = 10
        }
        if (len > MAX_FRAME_BYTES) {
          closeClient(client)
          return
        }
        const need = off + (masked ? 4 : 0) + len
        if (buf.length < need) return
        const maskKey = masked ? buf.subarray(off, off + 4) : null
        const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need))
        if (maskKey) {
          for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i & 3]
        }
        buf = buf.subarray(need)

        if (opcode === 0x8) {
          closeClient(client)
          clients.delete(client)
          return
        }
        if (opcode === 0x9) {
          if (!client.closed && socket.writable) socket.write(encodeFrame(0xa, payload))
          continue
        }
        if (opcode === 0xa) continue

        if (opcode === 0x0) {
          fragChunks.push(payload)
          const fragLen = fragChunks.reduce((s, c) => s + c.length, 0)
          if (fragLen > MAX_FRAME_BYTES) {
            fragChunks = []
            closeClient(client)
            clients.delete(client)
            return
          }
          if (fin) {
            const full = Buffer.concat(fragChunks)
            fragChunks = []
            if (fragOpcode === 0x1) {
              try {
                handleMessage(client, JSON.parse(full.toString('utf8')))
              } catch {
                /* bozuk json yoksay */
              }
            }
          }
          continue
        }

        if (!fin) {
          fragOpcode = opcode
          fragChunks = [payload]
          continue
        }

        if (opcode === 0x1) {
          try {
            handleMessage(client, JSON.parse(payload.toString('utf8')))
          } catch {
            /* bozuk json yoksay */
          }
        }
      }
    }

    if (buf.length > 0) pump()

    socket.on('data', (chunk) => {
      if (buf.length + chunk.length > MAX_FRAME_BYTES) {
        closeClient(client)
        clients.delete(client)
        return
      }
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      pump()
    })

    const onEnd = () => {
      closeClient(client)
      clients.delete(client)
    }
    socket.on('close', onEnd)
    socket.on('error', onEnd)
  })
}
