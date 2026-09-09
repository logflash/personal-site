import { createRoot } from 'react-dom/client'
import { App } from './App'
import { configureDemoFontMorph } from './fontMorph'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

configureDemoFontMorph()
createRoot(root).render(<App />)
