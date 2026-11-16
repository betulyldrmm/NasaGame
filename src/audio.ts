/** Müzik ve ses efektleri (game.zip içindeki dosyalar → public/audio). */
import type { WeaponKind } from './game/types'

type Music = 'menu' | 'build' | null

const SRC = {
  menu: '/audio/music_menu.mp3',
  build: '/audio/music_build.mp3',
  rocket: '/audio/rocket_loop.wav',
  explosion: '/audio/explosion.mp3',
  click: '/audio/click.mp3',
  lose: '/audio/lose.mp3',
}

const MUTE_KEY = 'nasagame-muted'
let muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'
let unlocked = false
let wanted: Music = null
let musicEl: HTMLAudioElement | null = null
let musicName: Music = null
// Motor sesi Web Audio ile örnek-hassas döngüde çalar: tek kaynak sürekli açık kalır, yalnızca ses
// düzeyi ve perdesi değişir; böylece ses başlayıp sönüp tekrar başlamaz.
type Engine = { ctx: AudioContext; gain: GainNode; src: AudioBufferSourceNode | null; loading: boolean }
let engine: Engine | null = null
let noiseBuf: AudioBuffer | null = null
let engineLevel = 0
let lastBoom = 0
let lastShieldSfx = 0
let lastChargeSfx = 0
const lastWeaponAt: Record<string, number> = {}
const listeners = new Set<() => void>()

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf
  const len = Math.floor(ctx.sampleRate * 0.45)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1
  noiseBuf = buf
  return buf
}

const can = typeof Audio !== 'undefined'

function applyMusic() {
  if (!can) return
  if (musicName !== wanted) {
    musicEl?.pause()
    musicEl = null
    musicName = wanted
    if (wanted) {
      musicEl = new Audio(SRC[wanted])
      musicEl.loop = true
      musicEl.volume = 0.32
    }
  }
  if (!musicEl) return
  if (muted || !unlocked) musicEl.pause()
  else void musicEl.play().catch(() => undefined)
}

function ensureEngine(): Engine | null {
  if (engine) return engine
  const Ctx = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
  if (!Ctx) return null
  const ctx = new Ctx()
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)
  engine = { ctx, gain, src: null, loading: true }
  const e = engine
  fetch(SRC.rocket)
    .then((r) => r.arrayBuffer())
    .then((b) => ctx.decodeAudioData(b))
    .then((buf) => {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(gain)
      src.start()
      e.src = src
      e.loading = false
      applyEngine()
    })
    .catch(() => {
      e.loading = false
    })
  return engine
}

function applyEngine() {
  if (!can || !unlocked) return
  const on = engineLevel > 0 && !muted
  if (!on && !engine) return
  const e = ensureEngine()
  if (!e) return
  if (e.ctx.state === 'suspended') void e.ctx.resume().catch(() => undefined)
  const t = e.ctx.currentTime
  const vol = on ? Math.min(0.7, 0.18 + 0.5 * engineLevel) : 0
  // Yumuşak geçiş: tık sesi olmadan açılır/kapanır.
  e.gain.gain.setTargetAtTime(vol, t, on ? 0.06 : 0.12)
  // Gaz arttıkça perde hafifçe yükselir; döngünün tekrarı da daha az fark edilir.
  if (e.src) e.src.playbackRate.setTargetAtTime(0.92 + 0.14 * engineLevel, t, 0.25)
}

export const audio = {
  /** Tarayıcılar ilk kullanıcı etkileşiminden önce ses çalmaya izin vermez. */
  unlock() {
    if (engine && engine.ctx.state === 'suspended') void engine.ctx.resume().catch(() => undefined)
    if (unlocked) return
    unlocked = true
    applyMusic()
    applyEngine()
  },
  music(name: Music) {
    wanted = name
    applyMusic()
  },
  sfx(name: 'click' | 'explosion' | 'lose', volume = 0.6) {
    if (!can || muted || !unlocked) return
    if (name === 'explosion') {
      const now = performance.now()
      if (now - lastBoom < 140) return
      lastBoom = now
    }
    const a = new Audio(SRC[name])
    a.volume = volume
    void a.play().catch(() => undefined)
  },
  /** Çok katmanlı prosedürel silah sesi (Web Audio): darbe gürültüsü + harmonik sentez. */
  weapon(kind: WeaponKind, volume = 0.45, pitch = 1) {
    if (!can || muted || !unlocked || volume <= 0.02) return
    const nowMs = performance.now()
    if (nowMs - (lastWeaponAt[kind] ?? 0) < 42) return
    lastWeaponAt[kind] = nowMs
    const e = ensureEngine()
    if (!e) return
    const ctx = e.ctx
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const t = ctx.currentTime
    const v = Math.min(0.6, Math.max(0.03, volume))

    const addNoise = (filterType: BiquadFilterType, freq: number, q: number, dur: number, gainAmp: number) => {
      const src = ctx.createBufferSource()
      src.buffer = getNoiseBuffer(ctx)
      const flt = ctx.createBiquadFilter()
      flt.type = filterType
      flt.frequency.setValueAtTime(freq * pitch, t)
      flt.Q.value = q
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(Math.max(0.002, v * gainAmp), t)
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur)
      src.connect(flt)
      flt.connect(ng)
      ng.connect(ctx.destination)
      src.start(t)
      src.stop(t + dur)
    }

    const addTone = (type: OscillatorType, f0: number, f1: number, dur: number, gainAmp: number) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(f0 * pitch, t)
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, f1 * pitch), t + dur)
      const og = ctx.createGain()
      og.gain.setValueAtTime(Math.max(0.002, v * gainAmp), t)
      og.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.connect(og)
      og.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
    }

    if (kind === 'beam') {
      addTone('sawtooth', 720, 440, 0.16, 0.28)
      addTone('triangle', 180, 120, 0.16, 0.25)
      addNoise('bandpass', 2400, 3.5, 0.14, 0.26)
    } else if (kind === 'railgun') {
      addTone('sawtooth', 2600, 85, 0.24, 0.42)
      addTone('sine', 160, 45, 0.28, 0.5)
      addNoise('highpass', 1800, 1.2, 0.18, 0.48)
    } else if (kind === 'plasma') {
      const src = ctx.createBufferSource()
      src.buffer = getNoiseBuffer(ctx)
      const flt = ctx.createBiquadFilter()
      flt.type = 'bandpass'
      flt.frequency.setValueAtTime(1150 * pitch, t)
      flt.frequency.exponentialRampToValueAtTime(170, t + 0.22)
      flt.Q.value = 6
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(v * 0.45, t)
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
      src.connect(flt)
      flt.connect(ng)
      ng.connect(ctx.destination)
      src.start(t)
      src.stop(t + 0.22)
      addTone('sine', 480, 140, 0.22, 0.35)
    } else if (kind === 'emp') {
      addTone('square', 840, 190, 0.26, 0.22)
      addTone('sawtooth', 420, 95, 0.28, 0.22)
      addNoise('bandpass', 3200, 4, 0.2, 0.32)
    } else if (kind === 'missile' || kind === 'rocket') {
      addTone('triangle', 220, 75, 0.16, 0.32)
      addNoise('bandpass', 950, 1.6, 0.26, 0.45)
    } else if (kind === 'torpedo') {
      addTone('sine', 130, 34, 0.36, 0.58)
      addNoise('lowpass', 480, 0.9, 0.34, 0.5)
    } else if (kind === 'flak') {
      addTone('square', 240, 52, 0.13, 0.36)
      addNoise('bandpass', 1350, 1.4, 0.16, 0.48)
    } else {
      // Ballistic (Vulcan / Twin / Siege cannon)
      addTone('triangle', 320, 68, 0.085, 0.38)
      addNoise('lowpass', 2100, 1.1, 0.07, 0.36)
    }
  },
  /** Şarjlı silahlar (Dev Ölüm Lazeri / Raylı Top) için yükselen ses tonu. */
  chargeHum(level: number, giantBeam: boolean) {
    if (!can || muted || !unlocked) return
    const nowMs = performance.now()
    if (nowMs - lastChargeSfx < 95) return
    lastChargeSfx = nowMs
    const e = ensureEngine()
    if (!e) return
    const ctx = e.ctx
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = giantBeam ? 'sawtooth' : 'sine'
    const f = (giantBeam ? 210 : 340) + level * (giantBeam ? 680 : 900)
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.linearRampToValueAtTime(f * 1.08, t + 0.09)
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.09)
  },
  /** Enerji kalkanı darbesi (kristal enerji kırılımı). */
  shieldHit(volume = 0.35) {
    if (!can || muted || !unlocked || volume <= 0.02) return
    const nowMs = performance.now()
    if (nowMs - lastShieldSfx < 75) return
    lastShieldSfx = nowMs
    const e = ensureEngine()
    if (!e) return
    const ctx = e.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1450, t)
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.14)
    g.gain.setValueAtTime(Math.min(0.25, volume * 0.35), t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.14)
  },
  /** Motor sesi: 0 kapalı … 1 tam gaz. */
  rocket(level: number) {
    engineLevel = level > 0.01 ? level : 0
    applyEngine()
  },
  get muted() {
    return muted
  },
  toggleMute() {
    muted = !muted
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      /* yok say */
    }
    applyEngine()
    applyMusic()
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

if (typeof window !== 'undefined') {
  const first = () => audio.unlock()
  window.addEventListener('pointerdown', first, { once: false })
  window.addEventListener('keydown', first, { once: false })
}
