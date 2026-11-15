/** Müzik ve ses efektleri (game.zip içindeki dosyalar → public/audio). */
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
let engineLevel = 0
let lastBoom = 0
const listeners = new Set<() => void>()

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
