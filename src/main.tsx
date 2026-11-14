import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import SettingsCorner from './components/SettingsCorner'
import { installTranslator } from './i18n'
import './audio'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <SettingsCorner />
  </StrictMode>,
)
installTranslator()
