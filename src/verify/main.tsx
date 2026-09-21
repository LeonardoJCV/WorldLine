import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../app/theme/tokens.css'
import { localeStore } from '../app/i18n/index.ts'
import { VerifyPage } from './VerifyPage.tsx'
import './verify.css'

document.documentElement.lang = localeStore.getState().locale

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

createRoot(root).render(
  <StrictMode>
    <VerifyPage />
  </StrictMode>,
)
