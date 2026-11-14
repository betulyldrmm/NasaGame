import type { PartDef, PartInst } from './types'

/** Parça kütleleri, itkiler ve fiyatlar oyun varsayımıdır; Isp oranları gerçek motor sınıflarını izler. */
export const INITIAL_MONEY = 40_000
export const GRID_W = 14
export const GRID_H = 30

export const PARTS: PartDef[] = [
  // Komuta
  { id: 'capsule', name: 'Mürettebat Kapsülü', kind: 'command', category: 'Komuta', w: 2, h: 2, mass: 1.2, cost: 1800, ecCap: 60, desc: 'Gemiyi kontrol eder. Tepki tekerleği ve küçük batarya içerir.' },
  { id: 'probe', name: 'Sonda Çekirdeği', kind: 'command', category: 'Komuta', w: 2, h: 1, mass: 0.3, cost: 900, ecCap: 30, desc: 'İnsansız, hafif kontrol birimi.' },
  { id: 'nose', name: 'Burun Konisi', kind: 'nose', category: 'Komuta', w: 2, h: 2, mass: 0.15, cost: 150, desc: 'Atmosferde sürüklenmeyi azaltır.' },
  // Yakıt
  { id: 'tank-s', name: 'Tank S', kind: 'tank', category: 'Yakıt', w: 2, h: 1, mass: 0.2, fuel: 2, cost: 300, desc: '2 t yakıt.' },
  { id: 'tank-m', name: 'Tank M', kind: 'tank', category: 'Yakıt', w: 2, h: 2, mass: 0.4, fuel: 4, cost: 550, desc: '4 t yakıt.' },
  { id: 'tank-l', name: 'Tank L', kind: 'tank', category: 'Yakıt', w: 2, h: 3, mass: 0.6, fuel: 6, cost: 800, desc: '6 t yakıt.' },
  { id: 'tank-xl', name: 'Tank XL', kind: 'tank', category: 'Yakıt', w: 2, h: 4, mass: 0.8, fuel: 8, cost: 1000, desc: '8 t yakıt.' },
  { id: 'tank-slim', name: 'İnce Tank', kind: 'tank', category: 'Yakıt', w: 1, h: 2, mass: 0.2, fuel: 2, cost: 320, desc: '2 t yakıt, 1 kare genişlik.' },
  // Motorlar
  { id: 'titan', name: 'Titan (kalkış)', kind: 'engine', category: 'Motorlar', w: 2, h: 3, mass: 3.0, thrust: 480, ispVac: 265, ispSL: 240, cost: 2600, desc: 'Çok yüksek itki, çok yakıt yakar. Dünya\'dan kalkış için.' },
  { id: 'hawk', name: 'Hawk (orta)', kind: 'engine', category: 'Motorlar', w: 2, h: 2, mass: 1.4, thrust: 180, ispVac: 285, ispSL: 235, cost: 1400, desc: 'Dengeli: yan iticiler ve ikinci kademe.' },
  { id: 'frontier', name: 'Frontier (vakum)', kind: 'engine', category: 'Motorlar', w: 2, h: 2, mass: 0.6, thrust: 60, ispVac: 345, ispSL: 100, cost: 1200, desc: 'Düşük itki ama uzayda çok verimli. Atmosferde gücünü kaybeder.' },
  { id: 'kolibri', name: 'Kolibri (mini)', kind: 'engine', category: 'Motorlar', w: 1, h: 1, mass: 0.15, thrust: 16, ispVac: 315, ispSL: 140, cost: 450, desc: 'Küçük iniş araçları için.' },
  { id: 'ion', name: 'İyon Motoru', kind: 'engine', category: 'Motorlar', w: 1, h: 1, mass: 0.12, thrust: 1.6, ispVac: 2100, ispSL: 2100, ecUse: 8, cost: 2200, desc: 'Minik itki, devasa verim. Elektrik ister: batarya + güneş paneli.' },
  // Kademe
  { id: 'decoupler', name: 'Dikey Kademe Adaptörü', kind: 'decoupler', category: 'Kademe', w: 2, h: 1, mass: 0.1, cost: 200, desc: 'Üst ve alt gövdeyi bağlar. Uçuşta tıkla: alt kademe ayrılır.' },
  { id: 'radial', name: 'Yatay Kademe Adaptörü', kind: 'radialDecoupler', category: 'Kademe', w: 1, h: 1, mass: 0.05, cost: 150, desc: 'Yan iticiyi ana gövdeye bağlar. Uçuşta tıkla: yan gövde ayrılır.' },
  // Güç
  { id: 'solar', name: 'Güneş Paneli', kind: 'solar', category: 'Güç', w: 1, h: 2, mass: 0.06, ecGen: 5, cost: 500, desc: 'Tıklayınca açılır/kapanır. Üretim Güneş\'e uzaklığın karesiyle azalır.' },
  { id: 'battery', name: 'Batarya', kind: 'battery', category: 'Güç', w: 2, h: 1, mass: 0.2, ecCap: 240, cost: 350, desc: 'Elektrik depolar.' },
  { id: 'rcs', name: 'RCS İticisi', kind: 'rcs', category: 'Güç', w: 1, h: 1, mass: 0.05, cost: 220, desc: 'Yan iticiler: hassas öteleme (I/J/K/L) ve daha hızlı dönüş.' },
  // İniş
  { id: 'chute', name: 'Paraşüt', kind: 'chute', category: 'İniş', w: 2, h: 1, mass: 0.1, cost: 300, desc: 'Yalnızca atmosferde çalışır (Dünya, kısmen Mars).' },
  { id: 'leg', name: 'İniş Ayağı', kind: 'leg', category: 'İniş', w: 1, h: 2, mass: 0.08, cost: 180, desc: 'Daha sert inişlere dayanır.' },
  // Kargo
  { id: 'cargo', name: 'Kargo Gövdesi', kind: 'cargo', category: 'Kargo', w: 2, h: 2, mass: 0.4, cargoCap: 4, cost: 600, desc: '4 t üs modülü veya maden taşır.' },
]

export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]))

export function partDef(id: string): PartDef {
  const d = PART_BY_ID[id]
  if (!d) throw new Error(`Bilinmeyen parça: ${id}`)
  return d
}

/** Hazır gelen "Selene I": Ay'a gidip dönebilen üç kademeli roket. */
export const DEFAULT_DESIGN: PartInst[] = [
  { def: 'chute', x: 6, y: 1 },
  { def: 'capsule', x: 6, y: 2 },
  { def: 'cargo', x: 6, y: 4 },
  { def: 'solar', x: 5, y: 4 },
  { def: 'solar', x: 8, y: 4 },
  { def: 'tank-m', x: 6, y: 6 },
  { def: 'rcs', x: 5, y: 6 },
  { def: 'rcs', x: 8, y: 6 },
  { def: 'leg', x: 5, y: 7 },
  { def: 'leg', x: 8, y: 7 },
  { def: 'frontier', x: 6, y: 8 },
  { def: 'decoupler', x: 6, y: 10 },
  { def: 'tank-l', x: 6, y: 11 },
  { def: 'hawk', x: 6, y: 14 },
  { def: 'decoupler', x: 6, y: 16 },
  { def: 'tank-xl', x: 6, y: 17 },
  { def: 'tank-xl', x: 6, y: 21 },
  { def: 'titan', x: 6, y: 25 },
  { def: 'radial', x: 5, y: 22 },
  { def: 'radial', x: 8, y: 22 },
  { def: 'nose', x: 3, y: 18 },
  { def: 'tank-l', x: 3, y: 20 },
  { def: 'hawk', x: 3, y: 23 },
  { def: 'nose', x: 9, y: 18 },
  { def: 'tank-l', x: 9, y: 20 },
  { def: 'hawk', x: 9, y: 23 },
]
