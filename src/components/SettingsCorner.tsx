import { useSyncExternalStore } from 'react'
import { audio } from '../audio'
import { lang, setLang } from '../i18n'

/** Sağ alt köşe: dil ve ses. Her ekranda görünür. */
export default function SettingsCorner() {
  const muted = useSyncExternalStore(audio.subscribe, () => audio.muted)
  return (
    <div className="corner-settings" data-no-i18n>
      <button onClick={() => audio.toggleMute()} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Sound off' : 'Sound on'}>{muted ? '🔇' : '🔊'}</button>
      <button className={lang === 'en' ? 'is-on' : ''} onClick={() => lang !== 'en' && setLang('en')}>English</button>
      <button className={lang === 'tr' ? 'is-on' : ''} onClick={() => lang !== 'tr' && setLang('tr')}>Türkçe</button>
    </div>
  )
}
