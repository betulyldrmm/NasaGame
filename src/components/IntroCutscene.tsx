import { useState } from 'react'
import GuideScene, { BUILD_STEPS, L, type SceneId } from './GuideScenes'

interface IntroCutsceneProps {
  onFinish: () => void
}

const SLIDES: { tag: string; title: string; caption: string; scene: SceneId }[] = [
  {
    tag: L('YIL 2026 · GÖREV KONTROLÜ', 'YEAR 2026 · MISSION CONTROL'),
    title: L('YENİ DÜNYALARA YOLCULUK', 'JOURNEY TO NEW WORLDS'),
    caption: L('Dünya yörüngesinden Ay ve Mars yüzeyine ilk modüler koloni görevleri başlıyor.', 'The first modular colony missions from Earth orbit to the surfaces of the Moon and Mars are starting.'),
    scene: 'journey',
  },
  {
    tag: L('ADIM 1 · ROKET HANGARI', 'STEP 1 · ROCKET HANGAR'),
    title: L('ROKETİNİ KUR', 'BUILD YOUR ROCKET'),
    caption: L('Kapsül, tank ve motorları ızgaraya yerleştir, kademeleri adaptörle ayır. TWR yeşil olsun!', 'Place a capsule, tanks and engines on the grid and split stages with adapters. Keep TWR green!'),
    scene: 'build',
  },
  {
    tag: L('ADIM 2 · UÇ, İN, KOLONİ KUR', 'STEP 2 · FLY, LAND, BUILD'),
    title: L('UÇ, İN VE KOLONİ KUR', 'FLY, LAND AND BUILD A COLONY'),
    caption: L("Yörüngeye çık, Ay'a in ve Dünya'dan kargoyla getirdiğin yapılarla güneş enerjili koloni kur.", 'Reach orbit, land on the Moon and build a solar-powered colony from the buildings you carried from Earth.'),
    scene: 'land',
  },
]

export default function IntroCutscene({ onFinish }: IntroCutsceneProps) {
  const [step, setStep] = useState(0)
  // Montaj sayfası kendi kendine geçmez: her tıklama bir adım ilerletir.
  const [buildStep, setBuildStep] = useState(0)
  const slide = SLIDES[step]!
  const last = step === SLIDES.length - 1
  const next = () => {
    if (slide.scene === 'build' && buildStep < BUILD_STEPS - 1) {
      setBuildStep((b) => b + 1)
      return
    }
    if (last) onFinish()
    else setStep((s) => s + 1)
  }

  return (
    <div className="cutscene-backdrop" role="dialog" aria-modal="true" aria-label="Giriş Sinematiği">
      <div className="cutscene-card panel-card">
        <div className="cutscene-topbar">
          <span className="eyebrow">
            <span /> {slide.tag}
          </span>
          <button type="button" className="skip-btn" onClick={onFinish}>
            Atla (Skip) →
          </button>
        </div>

        {/* Oyunun kendi çizimleriyle canlı sahne */}
        <div className="cutscene-stage">
          <GuideScene key={slide.scene} scene={slide.scene} height={260} step={slide.scene === 'build' ? buildStep : undefined} onAdvance={next} />
        </div>

        <div className="cutscene-copy">
          <h2>{slide.title}</h2>
          <p>{slide.caption}</p>
        </div>

        <div className="cutscene-footer">
          <div className="cutscene-dots">
            {SLIDES.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`cutscene-dot ${idx === step ? 'active' : ''}`}
                onClick={() => setStep(idx)}
                aria-label={`Sahne ${idx + 1}`}
              />
            ))}
          </div>

          <div className="cutscene-actions">
            <button type="button" className="button button-primary" onClick={next}>
              {last ? L('Bitir →', 'Finish →') : L('Sonraki →', 'Next →')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
