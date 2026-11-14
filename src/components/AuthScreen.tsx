import { useState } from 'react'
import { loginAccount, registerAccount } from '../game/store'

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const cleanUser = username.trim()
    if (!cleanUser) {
      setError('Kullanıcı adı girin.')
      return
    }
    if (mode === 'register' && password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    setBusy(true)
    const err = mode === 'login' ? await loginAccount(cleanUser, password) : await registerAccount(cleanUser, password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <main className="app-shell auth-shell">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <span className="wordmark">
          <span className="wordmark-icon" aria-hidden="true">✦</span>
          <span>MISSION CONTROL</span>
        </span>
        <span className="status">
          <span className="status-dot" /> HESAP VE BULUT KAYIT SİSTEMİ
        </span>
      </header>

      <section className="auth-wrap">
        <div className="auth-card panel-card">
          <p className="eyebrow"><span /> KOMUTA MERKEZİ ERİŞİMİ</p>
          <h1>{mode === 'login' ? 'Hesabına Giriş Yap' : 'Yeni Hesap Oluştur'}</h1>
          <p className="auth-sub">
            Tüm roket tasarımların, gezegen üslerin, teknoloji ağacın ve pasif gelir birikimin kendi hesabında saklanır.
          </p>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`auth-tab${mode === 'login' ? ' active' : ''}`}
              onClick={() => { setMode('login'); setError(null) }}
            >
              Giriş Yap
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={`auth-tab${mode === 'register' ? ' active' : ''}`}
              onClick={() => { setMode('register'); setError(null) }}
            >
              Hesap Oluştur
            </button>
          </div>

          <form onSubmit={submit} className="auth-form">
            <label>
              <span>Kullanıcı Adı</span>
              <input
                type="text"
                autoComplete="username"
                placeholder="örn. komutan_ay"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              <span>Şifre</span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="En az 4 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            {mode === 'register' && (
              <label>
                <span>Şifre Tekrar</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Şifreyi tekrar yaz"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="button button-primary auth-submit" disabled={busy}>
              {busy ? 'Bağlanıyor…' : mode === 'login' ? 'Giriş Yap ve Devam Et' : 'Hesap Oluştur ve Başla'}
            </button>
          </form>

          <p className="auth-hint">
            Kullanıcı adı 3–24 karakter (`a-z`, `0-9`, `_`, `-`). Yeni hesaplar Dünya'da başlangıç pasif gelir üssüyle başlar.
          </p>
        </div>
      </section>
    </main>
  )
}
