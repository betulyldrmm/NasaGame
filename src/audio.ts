/** Müzik ve ses efektleri (game.zip içindeki dosyalar → public/audio). */
type Music = 'menu' | 'build' | null

const SRC = {
  menu: '/audio/music_menu.mp3',
  build: '/audio/music_build.mp3',
  rocket: '/audio/rocket.mp3',
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
let rocketEl: HTMLAudioElement | null = null
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

export const audio = {
  /** Tarayıcılar ilk kullanıcı etkileşiminden önce ses çalmaya izin vermez. */
  unlock() {
    if (unlocked) return
    unlocked = true
    applyMusic()
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
    if (!can) return
    const on = level > 0.01 && !muted && unlocked
    if (!on) {
      if (rocketEl && !rocketEl.paused) rocketEl.pause()
      return
    }
    if (!rocketEl) {
      rocketEl = new Audio(SRC.rocket)
      rocketEl.loop = true
    }
    rocketEl.volume = Math.min(0.7, 0.18 + 0.5 * level)
    if (rocketEl.paused) void rocketEl.play().catch(() => undefined)
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
    if (muted) rocketEl?.pause()
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
  // Tüm düğmelerde tıklama sesi.
  window.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null
    if (el?.closest('button, [role="button"], select')) audio.sfx('click', 0.5)
  })
}
