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
  { val: 'siege', label: 'Koloni Baskını (Son Sağ Kalan)', short: 'Son Sağ Kalan' },
  { val: 'score15', label: '15 Puan (Hızlı Çatışma)', short: '15 Puan' },
  { val: 'score30', label: '30 Puan (Büyük Savaş)', short: '30 Puan' },
  { val: 'endless', label: 'Sonsuz Savaş', short: 'Sonsuz' },
]

const MONEY_CHOICES = [30_000, 50_000, 100_000, 200_000]

export default function MultiplayerLobby({ defaultName, onBack }: Props) {
  const mp = useMultiplayer()
  const [pilotName, setPilotName] = useState(defaultName || 'Pilot')
  const [mode, setMode] = useState<MultiplayerMode>('orbital-warfare')
  const [roomName, setRoomName] = useState(`${defaultName || 'Pilot'} Savaş Odası`)
  const [joinCode, setJoinCode] = useState('')
  const [targetPlanets, setTargetPlanets] = useState(4)
  const [warfareGoal, setWarfareGoal] = useState<WarfareGoal>('siege')
  const [startingMoney, setStartingMoney] = useState(100_000)
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

  const selectMode = (next: MultiplayerMode) => {
    setMode(next)
    if (next === 'orbital-warfare') {
      if (startingMoney < 100_000) setStartingMoney(100_000)
      if (roomName.endsWith('Koloni Odası')) setRoomName(`${pilotName || 'Pilot'} Savaş Odası`)
    } else {
      if (startingMoney === 100_000) setStartingMoney(50_000)
      if (roomName.endsWith('Savaş Odası')) setRoomName(`${pilotName || 'Pilot'} Koloni Odası`)
    }
  }

  const handleCreate = (e: FormEvent) => {
    e.preventDefault()
    void createRoom(pilotName.trim() || defaultName || 'Host', roomName.trim() || `${pilotName} Odası`, {
      mode,
      warfareGoal,
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
  const isWarfare = activeMode === 'orbital-warfare'
  const roomGoalLabel = (g?: WarfareGoal) => WARFARE_GOALS.find((x) => x.val === g)?.short ?? 'Son Sağ Kalan'

  return (
    <main className="mp-shell">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-icon" aria-hidden="true">{isWarfare ? '⚔️' : '🪐'}</span>
          <span>{isWarfare ? 'UZAY SAVAŞI' : 'KOLONİ YARIŞI'}</span>
          <small className="mp-sub-badge">
            {isWarfare ? 'ÇOK OYUNCULU · SİLAHLI ROKETLER & KOLONİ BASKINI' : 'ÇOK OYUNCULU · İLK KOLONİYİ KUR'}
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
                    className={`mp-mode-btn ${mode === 'orbital-warfare' ? 'is-active' : ''}`}
                    onClick={() => selectMode('orbital-warfare')}
                  >
                    <strong>⚔️ Uzay Savaşı</strong>
                    <small>Silahlı roketler & koloni yıkımı</small>
                  </button>
                  <button
                    type="button"
                    className={`mp-mode-btn ${mode === 'colony-race' ? 'is-active' : ''}`}
                    onClick={() => selectMode('colony-race')}
                  >
                    <strong>🪐 Koloni Yarışı</strong>
                    <small>Gezegen kolonileştirme yarışı</small>
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
                {mode === 'orbital-warfare' ? (
                  <label className="mp-field">
                    <span>Savaş Hedefi</span>
                    <select value={warfareGoal} onChange={(e) => setWarfareGoal(e.target.value as WarfareGoal)}>
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
                        <span className={`mp-mode-chip ${r.config.mode === 'orbital-warfare' ? 'is-war' : ''}`}>
                          {r.config.mode === 'orbital-warfare' ? '⚔️ Uzay Savaşı' : '🪐 Koloni Yarışı'}
                        </span>{' '}
                        <span className="mp-code-chip">{r.code}</span>
                      </div>
                      <small>
                        Ev sahibi: {r.hostName} · {r.playerCount}/{r.maxPlayers} oyuncu ·{' '}
                        {r.config.mode === 'orbital-warfare'
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
              <p className="eyebrow"><span /> {isWarfare ? 'UZAY SAVAŞI LOBİSİ' : 'KOLONİ YARIŞI LOBİSİ'}</p>
              <h2>{mp.room.name}</h2>
              <small>
                Hedef:{' '}
                <b>
                  {isWarfare
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
                    <span className="mp-pad-tag">Rampa #{p.slot + 1}</span>
                    {p.isHost && <span className="mp-host-tag">👑 Ev Sahibi</span>}
                  </li>
                ))}
              </ul>
              {isWarfare ? (
                <ul className="mp-rules">
                  <li>🔫 <b>12 Özgün Silah + Zırh & Kalkan:</b> Montajda <i>Silahlar</i> ve <i>Savunma</i> kategorilerinden roketini donat.</li>
                  <li>🎯 <b>FTL Nişan & Ateş:</b> <b>1–9</b> tuşlarıyla silah seç, <b>Sol Tık</b> veya <b>F</b> basılı tutarak Dev Ölüm Lazerini ve silahları ateşle!</li>
                  <li>🏰 <b>Koloni Savunması & Baskın:</b> Dünya ve gezegen üslerine <i>Uçaksavar Lazer, SAM Bataryası, Kalkan Kubbesi ve Onarım Hangarı</i> kur; düşman kolonilerini bombala!</li>
                  <li>⏱️ <b>Akıllı Hızlı Zaman & Yolculuk:</b> Çatışma dışı uzayda <b>◀◀ / ▶▶</b> ve <b>Hedefe Git</b> ile hızlan; savaş başlayınca zaman otomatik <b>1×</b> olur.</li>
                </ul>
              ) : (
                <ul className="mp-rules">
                  <li>🚩 <b>7 Kolonileştirilebilir Dünya:</b> Ay, Merkür, Venüs, Mars, Ceres, Ganimed, Titan.</li>
                  <li>🛰️ <b>Koloni:</b> Kargoda Uzay İstasyonu ve güneş paneli götür, yüzeye in ve kur; çalışan istasyon gezegeni senin yapar.</li>
                  <li>⚠️ <b>Dikkat:</b> Roketler birbirine çarparsa iki taraf da hasar görür.</li>
                  <li>⏱️ <b>Akıllı Zaman & Hızlı Yolculuk:</b> Uzayda otomatik hızlan ya da Hedefe Git kullan; yakın temasta anında 1×&apos;e iner. Odada en fazla 16 oyuncu.</li>
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
