/**
 * Dil katmanı. Oyunun kaynak metinleri Türkçedir; varsayılan dil İngilizce olduğu için
 * metinler ekrana basılırken sözlükle (en.ts) İngilizceye çevrilir. Sayılar ve gök cismi
 * adları yer tutucuya dönüştürülerek eşleştirilir, böylece "Ay yüzeyine iniş başarılı."
 * ve "Mars yüzeyine iniş başarılı." tek sözlük satırıyla çevrilir.
 */
import { EN } from './en'

export type Lang = 'en' | 'tr'
const KEY = 'nasagame-lang'

function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'tr' ? 'tr' : 'en'
  } catch {
    return 'en'
  }
}

export const lang: Lang = typeof localStorage === 'undefined' ? 'tr' : readLang()

export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* yok say */
  }
  window.location.reload()
}

const BODY_EN: Record<string, string> = {
  Güneş: 'Sun', Merkür: 'Mercury', Venüs: 'Venus', Dünya: 'Earth', Ay: 'Moon', Mars: 'Mars', Ceres: 'Ceres',
  Jüpiter: 'Jupiter', Ganimed: 'Ganymede', Satürn: 'Saturn', Titan: 'Titan',
}
const BODY_RE = new RegExp(`(?<![\\p{L}])(${Object.keys(BODY_EN).join('|')})(?![\\p{L}])`, 'gu')
const NUM_RE = /\d+(?:[.,]\d+)*/g
const UNIT_EN: Record<string, string> = { sa: 'h', dk: 'min', sn: 's' }
const UNIT_RE = /(?<=\{n\} |\/)(sa|dk|sn)(?![\p{L}])/gu

interface Norm {
  key: string
  nums: string[]
  bodies: string[]
  units: string[]
}

function normalize(text: string): Norm {
  const bodies: string[] = []
  const nums: string[] = []
  const units: string[] = []
  const key = text
    .replace(BODY_RE, (m) => {
      bodies.push(BODY_EN[m]!)
      return '{b}'
    })
    .replace(NUM_RE, (m) => {
      nums.push(m)
      return '{n}'
    })
    .replace(UNIT_RE, (m) => {
      units.push(UNIT_EN[m]!)
      return '{u}'
    })
  return { key, nums, bodies, units }
}

const DICT = new Map<string, string>()
for (const [tr, en] of Object.entries(EN)) DICT.set(normalize(tr).key, en)

function fill(template: string, n: Norm): string {
  let ni = 0
  let bi = 0
  let ui = 0
  return template
    .replace(/\{u\}/g, () => n.units[ui++] ?? '')
    .replace(/\{n(\d*)\}/g, (_m, idx: string) => (idx ? n.nums[Number(idx) - 1] : n.nums[ni++]) ?? '')
    .replace(/\{b(\d*)\}/g, (_m, idx: string) => (idx ? n.bodies[Number(idx) - 1] : n.bodies[bi++]) ?? '')
}

function lookup(text: string): string | null {
  const n = normalize(text)
  const hit = DICT.get(n.key)
  if (hit !== undefined) return fill(hit, n)
  // Yalnızca ad/sayı/birimden oluşan metinler ("Dünya", "Mars/Venüs") sözlüksüz çevrilir.
  if (/\{[bu]\}/.test(n.key) && !/\p{L}/u.test(n.key.replace(/\{[nbu]\}/g, ''))) return fill(n.key, n)
  return null
}

const SPLIT = /( · | — | → |: |\n| \(|\)|, |  (?=\+)|(?<=×) |(?<=[.!?…]) (?=[\p{Lu}'"✓⚠🛰🎯]))/u
const cache = new Map<string, string>()

/** Türkçe metni etkin dile çevirir (Türkçe modda aynen döner). */
export function T(text: string): string {
  if (lang === 'tr' || !text) return text
  const cached = cache.get(text)
  if (cached !== undefined) return cached
  const lead = text.match(/^\s*/)![0]
  const trail = text.match(/\s*$/)![0]
  const core = text.slice(lead.length, text.length - trail.length)
  let out = core ? lookup(core) : null
  if (out === null && core) {
    const parts = core.split(SPLIT)
    if (parts.length > 1) {
      let any = false
      const tr = parts.map((p) => {
        if (!p || SPLIT.test(p)) return p
        const t = lookup(p.trim())
        if (t !== null) {
          any = true
          return p.replace(p.trim(), t)
        }
        return p
      })
      if (any) out = tr.join('')
    }
  }
  if (out === null && /[çğıöşüÇĞİÖŞÜ]|\p{L}{4}/u.test(core)) (globalThis as { __i18nMiss?: Set<string> }).__i18nMiss?.add(core)
  const result = out === null ? text : lead + out + trail
  if (cache.size < 5000) cache.set(text, result)
  return result
}

const ATTRS = ['title', 'placeholder', 'aria-label']

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const v = node.nodeValue
    if (v && /\p{L}{2}/u.test(v)) {
      const t = T(v)
      if (t !== v) node.nodeValue = t
    }
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as Element
  if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.hasAttribute('data-no-i18n')) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v) {
      const t = T(v)
      if (t !== v) el.setAttribute(a, t)
    }
  }
  for (const child of Array.from(el.childNodes)) translateNode(child)
}

/** İngilizce modda DOM'a yazılan her metni ve canvas yazılarını çevirir. */
export function installTranslator() {
  if (lang === 'tr' || typeof document === 'undefined') return
  document.documentElement.lang = 'en'
  ;(globalThis as { __i18nMiss?: Set<string> }).__i18nMiss = new Set()
  translateNode(document.body)
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target)
      else if (m.type === 'attributes') translateNode(m.target)
      else m.addedNodes.forEach(translateNode)
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  const proto = CanvasRenderingContext2D.prototype
  const fillText = proto.fillText
  proto.fillText = function patched(this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    return maxWidth === undefined ? fillText.call(this, T(String(text)), x, y) : fillText.call(this, T(String(text)), x, y, maxWidth)
  }
  const confirm0 = window.confirm.bind(window)
  window.confirm = (msg?: string) => confirm0(T(msg ?? ''))
  const prompt0 = window.prompt.bind(window)
  window.prompt = (msg?: string, def?: string) => prompt0(T(msg ?? ''), def)
}
