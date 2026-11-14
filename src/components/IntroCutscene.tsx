import { useEffect, useState } from 'react'

interface IntroCutsceneProps {
  onFinish: () => void
}

const SLIDES = [
  {
    tag: 'YIL 2026 · GÖREV KONTROLÜ',
    title: 'YENİ DÜNYALARA YOLCULUK',
    caption: 'Dünya yörüngesinden Ay ve Mars yüzeyine ilk modüler koloni görevleri başlıyor.',
  },
  {
    tag: 'ADIM 1 · DİNAMİK ROKET HANGARI',
    title: 'PARÇALARI BİRLEŞTİR',
    caption: 'Gövde, yakıt tankı, kanatçık ve motoru seç. Sarı Daire (CoM) üstte, TWR yeşil olsun!',
  },
  {
    tag: 'ADIM 2 · SPACEFLIGHT & SPACE ENGINEERS',
    title: 'UÇUR, İNDİR VE İNŞA ET!',
    caption: 'Ters itki motorlarıyla yüzeye yumuşak iniş yap ve piksel bloklarla kendi kolonini kur!',
  },
] as const

export default function IntroCutscene({ onFinish }: IntroCutsceneProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (step < SLIDES.length - 1) setStep((s) => s + 1)
    }, 3800)
    return () => clearTimeout(timer)
  }, [step])

  const slide = SLIDES[step]!

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

        {/* Pixel-Art Animated Stage */}
        <div className="cutscene-stage">
          {step === 0 && (
            <svg viewBox="0 0 360 190" className="pixel-scene-svg" shapeRendering="crispEdges">
              <rect width="360" height="190" fill="#071022" />
              {/* Pixel Stars */}
              <rect x="28" y="24" width="4" height="4" fill="#F3F7FF" />
              <rect x="92" y="48" width="3" height="3" fill="#38D9E8" />
              <rect x="280" y="30" width="4" height="4" fill="#FFAD57" />
              <rect x="320" y="90" width="3" height="3" fill="#F3F7FF" />
              <rect x="60" y="140" width="4" height="4" fill="#9CAECC" />
              {/* Pixel Earth */}
              <rect x="64" y="64" width="64" height="64" fill="#1D4ED8" />
              <rect x="72" y="56" width="48" height="80" fill="#2563EB" />
              <rect x="56" y="72" width="80" height="48" fill="#2563EB" />
              <rect x="76" y="74" width="24" height="18" fill="#4ADE80" />
              <rect x="98" y="98" width="20" height="16" fill="#4ADE80" />
              {/* Dotted Trajectory */}
              <rect x="148" y="88" width="8" height="4" fill="#38D9E8" />
              <rect x="166" y="82" width="8" height="4" fill="#38D9E8" />
              <rect x="184" y="78" width="8" height="4" fill="#38D9E8" />
              <rect x="202" y="76" width="8" height="4" fill="#38D9E8" />
              <rect x="220" y="78" width="8" height="4" fill="#38D9E8" />
              {/* Pixel Moon & Mars */}
              <rect x="242" y="58" width="32" height="32" fill="#94A3B8" />
              <rect x="248" y="64" width="8" height="8" fill="#64748B" />
              <rect x="296" y="102" width="40" height="40" fill="#EA580C" />
              <rect x="304" y="110" width="12" height="10" fill="#9A3412" />
              {/* Animated Mini Pixel Rocket flying across trajectory */}
              <g className="cutscene-ship-glide">
                <rect x="170" y="72" width="16" height="8" fill="#F3F7FF" />
                <polygon points="186,72 194,76 186,80" fill="#FFAD57" />
                <rect x="162" y="74" width="8" height="4" fill="#38D9E8" />
              </g>
            </svg>
          )}

          {step === 1 && (
            <svg viewBox="0 0 360 190" className="pixel-scene-svg" shapeRendering="crispEdges">
              <rect width="360" height="190" fill="#071022" />
              {/* Blueprint Grid */}
              {Array.from({ length: 12 }, (_, i) => (
                <rect key={`v-${i}`} x={i * 30} y="0" width="1" height="190" fill="#38D9E822" />
              ))}
              {Array.from({ length: 7 }, (_, i) => (
                <rect key={`h-${i}`} x="0" y={i * 30} width="360" height="1" fill="#38D9E822" />
              ))}
              {/* Modular Pixel Rocket Snapping Together */}
              <polygon points="180,20 202,48 158,48" fill="#FFAD57" />
              <rect x="158" y="52" width="44" height="42" fill="#E2E8F0" />
              <rect x="168" y="62" width="24" height="14" fill="#38D9E8" />
              <rect x="158" y="98" width="44" height="36" fill="#3B82F6" />
              <rect x="142" y="118" width="16" height="18" fill="#FB7185" />
              <rect x="202" y="118" width="16" height="18" fill="#FB7185" />
              <rect x="166" y="138" width="28" height="18" fill="#FFAD57" />
              {/* CoM Yellow & CoP Blue */}
              <rect x="174" y="76" width="12" height="12" fill="#FACC15" />
              <polygon points="180,118 190,132 170,132" fill="#38D9E8" />
              <text x="64" y="86" fill="#FACC15" fontSize="10" fontFamily="DM Mono, monospace">
                ● CoM (ÜSTTE)
              </text>
              <text x="228" y="130" fill="#38D9E8" fontSize="10" fontFamily="DM Mono, monospace">
                ▲ CoP (ALTTA)
              </text>
            </svg>
          )}

          {step === 2 && (
            <svg viewBox="0 0 360 190" className="pixel-scene-svg" shapeRendering="crispEdges">
              <rect width="360" height="190" fill="#071022" />
              {/* Planet Surface & Underground */}
              <rect x="0" y="128" width="360" height="22" fill="#9A3412" />
              <rect x="0" y="150" width="360" height="40" fill="#431407" />
              {/* Glowing Underground Ore Pixels */}
              <rect x="64" y="162" width="8" height="8" fill="#FACC15" />
              <rect x="76" y="168" width="6" height="6" fill="#38D9E8" />
              <rect x="280" y="160" width="8" height="8" fill="#FACC15" />
              {/* Landed Rocket with Retro Flame */}
              <g className="cutscene-lander-hover">
                <polygon points="110,44 126,64 94,64" fill="#FFAD57" />
                <rect x="94" y="64" width="32" height="44" fill="#E2E8F0" />
                <rect x="102" y="108" width="16" height="10" fill="#38D9E8" />
                <polygon points="103,118 117,118 110,130" fill="#FFAD57" className="pixel-flame-flicker" />
              </g>
              {/* Pixel Colony Blocks on Right */}
              <rect x="176" y="96" width="44" height="32" fill="#1E293B" stroke="#4ADE80" strokeWidth="2" />
              <rect x="184" y="108" width="28" height="12" fill="#4ADE80" />
              <rect x="224" y="96" width="44" height="32" fill="#1E293B" stroke="#38D9E8" strokeWidth="2" />
              <rect x="276" y="104" width="36" height="8" fill="#38D9E8" />
              <rect x="290" y="112" width="8" height="16" fill="#94A3B8" />
            </svg>
          )}
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
            {step < SLIDES.length - 1 ? (
              <button type="button" className="button button-secondary" onClick={() => setStep((s) => s + 1)}>
                Sonraki →
              </button>
            ) : null}
            <button type="button" className="button button-primary" onClick={onFinish}>
              🚀 Hangara Gir ve Başla!
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
