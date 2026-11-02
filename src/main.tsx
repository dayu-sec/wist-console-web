import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './theme'
import './styles.css'

// 首次渲染**之前**定下主题：晚一步会先按深色画一帧再跳浅色（闪一下）。
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
