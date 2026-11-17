import { useEffect, useState, type FormEvent } from 'react'
import {
  clearMpError,
  createRoom,
  exitMpMode,
  joinRoom,
  leaveMpRoom,
  refreshRooms,
  sendMpChat,
  startMpMatch,
  useMultiplayer,
} from '../flight/mpClient'
import type { MultiplayerMode, WarfareGoal } from '../game/types'

interface Props {
  defaultName: string
  onBack: () => void
}

const TARGET_CHOICES = [
  { val: 3, label: '3 Gezegen (Hızlı)' },
  { val: 4, label: '4 Gezegen (Standart)' },
  { val: 5, label: '5 Gezegen (Uzun)' },
  { val: 7, label: '7 Gezegen (Hepsi)' },
  { val: 0, label: 'Sonsuz Mod' },
]

const WARFARE_GOALS: { val: WarfareGoal; label: string; short: string }[] = [
  { val: 'raid', label: '🏴‍☠️ Uzay Yağması (Üs & Ganimet)', short: 'Uzay Yağması' },
  { val: 'siege', label: '🏰 Koloni Baskını (Son Sağ Kalan)', short: 'Son Sağ Kalan' },
  { val: 'score15', label: '🎯 15 Puan (Hızlı Çatışma)', short: '15 Puan' },
  { val: 'score30', label: '🔥 30 Puan (Büyük Savaş)', short: '30 Puan' },
  { val: 'endless', label: '♾️ Sonsuz Savaş', short: 'Sonsuz' },
]

const LOOT_GOALS = [
  { val: 30, label: '30 t ganimet (Hızlı)' },
  { val: 60, label: '60 t ganimet (Standart)' },
  { val: 120, label: '120 t ganimet (Uzun)' },
  { val: 0, label: 'Sonsuz Yağma' },
]

const MONEY_CHOICES = [35_000, 45_000, 60_000, 100_000, 200_000]

const MODE_LABEL: Record<MultiplayerMode, string> = {
  'loot-raid': '⚔️ Uzay Savaşı · Yağma',
  'orbital-warfare': '⚔️ Uzay Savaşı',
  'colony-race': '🪐 Koloni Yarışı',
}

export default function MultiplayerLobby({ defaultName, onBack }: Props) {
  const mp = useMultiplayer()
  const [pilotName, setPilotName] = useState(defaultName || 'Pilot')
  const [mode, setMode] = useState<MultiplayerMode>('orbital-warfare')
  const [warfareGoal, setWarfareGoal] = useState<WarfareGoal>('raid')
  const [roomName, setRoomName] = useState(`${defaultName || 'Pilot'} Yağma Odası`)
  const [joinCode, setJoinCode] = useState('')
  const [targetPlanets, setTargetPlanets] = useState(4)
  const [startingMoney, setStartingMoney] = useState(45_000)
  const [lootGoal, setLootGoal] = useState(60)
  const [allowAutoWarp] = useState(true)
  const [chatText, setChatText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void refreshRooms().catch(() => {})
    const t = window.setInterval(() => {
      if (!mp.room) void refreshRooms().catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [mp.room])

  const selectMode = (next: MultiplayerMode, goalOverride?: WarfareGoal) => {
    setMode(next)
    const g = goalOverride ?? warfareGoal
    const isRaidSel = next === 'orbital-warfare' && g === 'raid'
    setStartingMoney(isRaidSel ? 45_000 : next === 'orbital-warfare' ? 100_000 : 50_000)
    if (/(Savaş|Koloni|Yağma) Odası$/.test(roomName)) {
      const suffix = isRaidSel ? 'Yağma' : next === 'orbital-warfare' ? 'Savaş' : 'Koloni'
      setRoomName(`${pilotName || 'Pilot'} ${suffix} Odası`)
    }
  }

  const selectWarfareGoal = (nextGoal: WarfareGoal) => {
    setWarfareGoal(nextGoal)
    setStartingMoney(nextGoal === 'raid' ? 45_000 : 100_000)
    if (/(Savaş|Koloni|Yağma) Odası$/.test(roomName)) {
      setRoomName(`${pilotName || 'Pilot'} ${nextGoal === 'raid' ? 'Yağma' : 'Savaş'} Odası`)
    }
  }

  const handleCreate = (e: FormEvent) => {
    e.preventDefault()
    void createRoom(pilotName.trim() || defaultName || 'Host', roomName.trim() || `${pilotName} Odası`, {
      mode,
      warfareGoal,
      lootGoal,
      targetPlanets,
      startingMoney,
      allowAutoWarp,
    })
  }

  const handleJoin = (e: FormEvent) => {
    e.preventDefault()
    if (!joinCode.trim()) return
    void joinRoom(joinCode.trim(), pilotName.trim() || defaultName || 'Pilot')
  }

  const handleSendChat = (e: FormEvent) => {
    e.preventDefault()
    if (!chatText.trim()) return
    sendMpChat(chatText)
    setChatText('')
  }

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const activeMode: MultiplayerMode = mp.room?.config.mode ?? mode
  const activeWarGoal: WarfareGoal = mp.room?.config.warfareGoal ?? warfareGoal
  const isLoot = activeMode === 'loot-raid' || (activeMode === 'orbital-warfare' && activeWarGoal === 'raid')
  const isWarfare = activeMode === 'orbital-warfare' || isLoot
  const roomGoalLabel = (g?: WarfareGoal) => WARFARE_GOALS.find((x) => x.val === g)?.short ?? 'Son Sağ Kalan'
  const lootGoalLabel = (g?: number) => ((g ?? 60) === 0 ? 'Sonsuz Yağma' : `${g ?? 60} t ganimet`)

  return (
    <main className="mp-shell">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-icon" aria-hidden="true">{isWarfare ? '⚔️' : '🪐'}</span>
          <span>{isWarfare ? (isLoot ? 'UZAY SAVAŞI · YAĞMA' : 'UZAY SAVAŞI') : 'KOLONİ YARIŞI'}</span>
          <small className="mp-sub-badge">
            {isLoot
              ? 'ÇOK OYUNCULU · ÜS GELİŞTİRME, GANİMET & PvP'
              : isWarfare
                ? 'ÇOK OYUNCULU · SİLAHLI ROKETLER, ÇEYREK İSTASYONLAR & BASKIN'
                : 'ÇOK OYUNCULU · 4 ÇEYREKLİ GEZEGEN KOLONİLEŞTİRME'}
          </small>
        </div>
        <div className="topbar-account">
          {mp.connected && mp.pingMs !== null && (
            <span className={`mp-ping-pill ${mp.pingMs < 60 ? 'is-good' : mp.pingMs < 140 ? 'is-mid' : 'is-bad'}`}>
              📶 {mp.pingMs} ms
            </span>
          )}
          <span className={`mp-conn-pill ${mp.connected ? 'is-ok' : ''}`}>
            {mp.connecting ? 'Bağlanıyor…' : mp.connected ? '● Sunucu Açık' : '○ Bağlantı yok'}
          </span>
          <button
            type="button"
            className="hud-btn"
            onClick={() => {
              exitMpMode()
              onBack()
            }}
          >
            ← Tek Oyunculu
          </button>
        </div>
      </header>

      {mp.error && (
        <div className="mp-error-bar">
          <span>⚠ {mp.error}</span>
          <button type="button" className="hud-btn" onClick={clearMpError}>Tamam</button>
        </div>
      )}

      {!mp.room ? (
        <section className="mp-lobby-grid">
          <div className="panel-card mp-card">
            <p className="eyebrow"><span /> YENİ ODA KUR</p>
            <h2>Ev Sahibi Ol</h2>
            <form className="mp-form" onSubmit={handleCreate}>
              <div className="mp-field">
                <span>Oyun Modu</span>
                <div className="mp-mode-switch" role="group" aria-label="Oyun Modu">
                  <button
                    type="button"
                    className={`mp-mode-btn ${mode !== 'colony-race' ? 'is-active' : ''}`}
                    onClick={() => selectMode('orbital-warfare')}
                  >
                    <strong>⚔️ Uzay Savaşı</strong>
                    <small>Kuşatma, Puan &amp; Yağma kategorileri</small>
                  </button>
                  <button
                    type="button"
                    className={`mp-mode-btn ${mode === 'colony-race' ? 'is-active' : ''}`}
                    onClick={() => selectMode('colony-race')}
                  >
                    <strong>🪐 Koloni Yarışı</strong>
                    <small>4 çeyrekli gezegen fethi</small>
                  </button>
                </div>
              </div>
              <label className="mp-field">
                <span>Pilot Adın</span>
                <input
                  type="text"
                  maxLength={20}
                  value={pilotName}
                  onChange={(e) => setPilotName(e.target.value)}
                  placeholder="Pilot"
                />
              </label>
              <label className="mp-field">
                <span>Oda Adı</span>
                <input
                  type="text"
                  maxLength={32}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Oda Adı"
                />
              </label>
              <div className="mp-form-row">
                {mode !== 'colony-race' ? (
                  <label className="mp-field">
                    <span>Savaş Kategorisi</span>
                    <select value={warfareGoal} onChange={(e) => selectWarfareGoal(e.target.value as WarfareGoal)}>
                      {WARFARE_GOALS.map((g) => (
                        <option key={g.val} value={g.val}>{g.label}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="mp-field">
                    <span>Zafer Hedefi</span>
                    <select value={targetPlanets} onChange={(e) => setTargetPlanets(Number(e.target.value))}>
                      {TARGET_CHOICES.map((c) => (
                        <option key={c.val} value={c.val}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="mp-field">
                  <span>Başlangıç Bütçesi</span>
                  <select value={startingMoney} onChange={(e) => setStartingMoney(Number(e.target.value))}>
                    {MONEY_CHOICES.map((m) => (
                      <option key={m} value={m}>{m.toLocaleString('tr-TR')} ₡</option>
                    ))}
                  </select>
                </label>
              </div>
              {mode !== 'colony-race' && warfareGoal === 'raid' && (
                <label className="mp-field">
                  <span>Yağma Ganimet Hedefi</span>
                  <select value={lootGoal} onChange={(e) => setLootGoal(Number(e.target.value))}>
                    {LOOT_GOALS.map((g) => (
                      <option key={g.val} value={g.val}>{g.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="submit" className="button button-primary">
                ＋ Oda Oluştur
              </button>
            </form>
          </div>

          <div className="panel-card mp-card">
            <div className="mp-card-head">
              <div>
                <p className="eyebrow"><span /> YEREL AĞ & KOD</p>
                <h2>Odaya Katıl</h2>
              </div>
              <button type="button" className="hud-btn" onClick={() => void refreshRooms()}>
                ⟳ Yenile
              </button>
            </div>
            <form className="mp-join-row" onSubmit={handleJoin}>
              <input
                type="text"
                maxLength={20}
                value={pilotName}
                onChange={(e) => setPilotName(e.target.value)}
                placeholder="Pilot Adın"
                aria-label="Pilot Adı"
              />
              <input
                type="text"
                maxLength={6}
                className="mp-code-input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="KOD"
                aria-label="Oda Kodu"
              />
              <button type="submit" className="button button-primary">
                Katıl
              </button>
            </form>

            <div className="mp-rooms-list">
              {mp.rooms.length === 0 ? (
                <div className="mp-empty">
                  Henüz açık oda yok. Soldan oda kur ya da 4 haneli kod gir.
                </div>
              ) : (
                mp.rooms.map((r) => (
                  <div key={r.code} className="mp-room-item">
                    <div>
                      <div className="mp-room-title">
                        <b>{r.name}</b>{' '}
                        <span className={`mp-mode-chip ${r.config.mode === 'colony-race' || !r.config.mode ? '' : 'is-war'}`}>
                          {r.config.mode === 'loot-raid' || (r.config.mode === 'orbital-warfare' && r.config.warfareGoal === 'raid')
                            ? '⚔️ Uzay Savaşı · Yağma'
                            : MODE_LABEL[r.config.mode ?? 'colony-race']}
                        </span>{' '}
                        <span className="mp-code-chip">{r.code}</span>
                      </div>
                      <small>
                        Ev sahibi: {r.hostName} · {r.playerCount}/{r.maxPlayers} oyuncu ·{' '}
                        {r.config.mode === 'loot-raid' || (r.config.mode === 'orbital-warfare' && r.config.warfareGoal === 'raid')
                          ? lootGoalLabel(r.config.lootGoal)
                          : r.config.mode === 'orbital-warfare'
                          ? roomGoalLabel(r.config.warfareGoal)
                          : r.config.targetPlanets === 0
                            ? 'Sonsuz'
                            : `${r.config.targetPlanets} gezegen`}{' '}
                        · {r.started ? 'Oyunda' : 'Lobide'}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void joinRoom(r.code, pilotName.trim() || defaultName || 'Pilot')}
                    >
                      Katıl
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="panel-card mp-room-card">
          <div className="mp-room-head">
            <div>
              <p className="eyebrow"><span /> {isLoot ? 'YAĞMA LOBİSİ' : isWarfare ? 'UZAY SAVAŞI LOBİSİ' : 'KOLONİ YARIŞI LOBİSİ'}</p>
              <h2>{mp.room.name}</h2>
              <small>
                Hedef:{' '}
                <b>
                  {isLoot
                    ? lootGoalLabel(mp.room.config.lootGoal)
                    : isWarfare
                    ? roomGoalLabel(mp.room.config.warfareGoal)
                    : mp.room.config.targetPlanets === 0
                      ? 'Sonsuz Mod'
                      : `${mp.room.config.targetPlanets} gezegen`}
                </b>{' '}
                · Bütçe: <b>{mp.room.config.startingMoney.toLocaleString('tr-TR')} ₡</b> · Zaman: <b>Akıllı</b>
              </small>
            </div>
            <button type="button" className="mp-code-banner" onClick={() => copyCode(mp.room!.code)} title="Kopyala">
              <small>ODA KODU</small>
              <strong>{mp.room.code}</strong>
              <span>{copied ? '✓ Kopyalandı' : 'Kopyala'}</span>
            </button>
          </div>

          <div className="mp-room-body">
            <div className="mp-players-col">
              <h3>Oyuncular ({mp.room.players.length}/{mp.room.maxPlayers ?? 16})</h3>
              <ul className="mp-player-list">
                {mp.room.players.map((p) => (
                  <li key={p.id} className="mp-player-row">
                    <span className="mp-dot" style={{ background: p.color }} />
                    <span className="mp-pname">
                      {p.username} {p.id === mp.you?.id ? <small>(Sen)</small> : null}
                    </span>
                    <span className="mp-pad-tag">{isLoot ? 'Üs' : 'Rampa'} #{p.slot + 1}</span>
                    {p.isHost && <span className="mp-host-tag">👑 Ev Sahibi</span>}
                  </li>
                ))}
              </ul>
              {isLoot ? (
                <ul className="mp-rules">
                  <li>🛰️ Bu modda gezegen yolculuğu yok: tüm çatışma arenadaki <b>Seviye 1–5</b> yükseltilebilir uzay üssün etrafında döner.</li>
                  <li>📦 Kaynak sahalarına uç, sandıkları kargona al ve üssüne taşı: her ton <b>7.200+ ₡</b> (üst seviye bonusuyla!).</li>
                  <li>🏗️ Üssünü <b>Seviye 5 Kale İstasyonu</b>na kadar geliştir: 10 taret, 8 kalkan, zırh, yüksek pasif gelir ve hızlı tamir!</li>
                  <li>🏴‍☠️ Vurduğun gemi kargosunu saçar; çekirdeğini yok ettiğin üs kasasının %30&apos;unu bırakır.</li>
                  <li>🕹️ Arcade uçuş: yerçekimi yok. W/S itki, A/D dönüş, 1–9 silah/dron seç, Sol Tık / F ateş.</li>
                </ul>
              ) : isWarfare ? (
                <ul className="mp-rules">
                  <li>🔫 <b>12 Özgün Silah + Dron Fırlatıcı + Zırh &amp; Kalkan:</b> Dron fırlatıcılarıyla yüzeyleri tara, kargo taşı ve çeyrekleri kolonileştir!</li>
                  <li>🎯 <b>FTL Nişan &amp; Ateş:</b> <b>1–9</b> tuşlarıyla silah/dron seç, <b>Sol Tık</b> veya <b>F</b> ile ateşle!</li>
                  <li>🏰 <b>4 Çeyrek Koloni &amp; Yerel Fırlatma:</b> Aktif Uzay İstasyonu kurduğun çeyrekte doğrudan bina inşa et; <b>Fırlatma Rampası</b> ile doğrudan o çeyrekten kalk!</li>
                  <li>⏱️ <b>Akıllı Hızlı Zaman &amp; Yolculuk:</b> Çatışma dışı uzayda <b>◀◀ / ▶▶</b> ve <b>Hedefe Git</b> ile hızlan; savaş başlayınca zaman otomatik <b>1×</b> olur.</li>
                </ul>
              ) : (
                <ul className="mp-rules">
                  <li>🚩 <b>7 Gezegen × 4 Çeyrek (Kuzey/Doğu/Güney/Batı):</b> Uzay İstasyonu yalnızca kurulduğu çeyreği kolonileştirir ve yerel inşaatı açar!</li>
                  <li>🛸 <b>Dron Fırlatıcı &amp; Rampa:</b> Dron ile diğer çeyreklere kargo taşı; <b>Fırlatma Rampası</b> kurulan çeyrekten roket fırlat!</li>
                  <li>⚠️ <b>Dikkat:</b> Roketler birbirine çarparsa iki taraf da hasar görür. Dronlar uzay sınırını aşarsa parçalanır.</li>
                  <li>⏱️ <b>Akıllı Zaman &amp; Hızlı Yolculuk:</b> Uzayda otomatik hızlan ya da Hedefe Git kullan; yakın temasta anında 1×&apos;e iner.</li>
                </ul>
              )}
            </div>

            <div className="mp-chat-col">
              <h3>Oda Sohbeti</h3>
              <div className="mp-chat-log">
                {mp.chat.length === 0 ? (
                  <span className="mp-chat-empty">Takım arkadaşlarınla veya rakiplerle yazış…</span>
                ) : (
                  mp.chat.map((c) => (
                    <div key={c.id} className="mp-chat-line">
                      <b style={{ color: c.color }}>{c.username}:</b> <span>{c.text}</span>
                    </div>
                  ))
                )}
              </div>
              <form className="mp-chat-form" onSubmit={handleSendChat}>
                <input
                  type="text"
                  maxLength={140}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Mesaj yaz…"
                />
                <button type="submit" className="hud-btn">Gönder</button>
              </form>
            </div>
          </div>

          <footer className="mp-room-foot">
            <button type="button" className="button button-secondary" onClick={() => leaveMpRoom(false)}>
              Odadan Ayrıl
            </button>
            {mp.isHost ? (
              <button type="button" className="button button-primary" onClick={startMpMatch}>
                🚀 Görevi Başlat
              </button>
            ) : (
              <span className="mp-wait-note">Ev sahibinin görevi başlatması bekleniyor…</span>
            )}
          </footer>
        </section>
      )}
    </main>
  )
}
