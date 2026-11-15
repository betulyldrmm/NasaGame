import { useSyncExternalStore } from 'react'
import { audio } from '../audio'
import { lang, setLang } from '../i18n'
import { menuState } from './menuState'

/** Sağ alt köşe: ses her ekranda, dil seçimi yalnızca ana menüde. */
export default function SettingsCorner() {
  const muted = useSyncExternalStore(audio.subscribe, () => audio.muted)
  const inMenu = useSyncExternalStore(menuState.subscribe, menuState.get)
  return (
    <div className="corner-settings" data-no-i18n>
      <button onClick={() => audio.toggleMute()} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Sound off' : 'Sound on'}>{muted ? '🔇' : '🔊'}</button>
      {inMenu && (
        <>
          <button className={lang === 'en' ? 'is-on' : ''} onClick={() => lang !== 'en' && setLang('en')}>English</button>
          <button className={lang === 'tr' ? 'is-on' : ''} onClick={() => lang !== 'tr' && setLang('tr')}>Türkçe</button>
        </>
      )}
    </div>
  )
}
