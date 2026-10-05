export const THEME_STORAGE_KEY = 'ian-site-theme'

// Run before CSS/first paint. Only a visitor's explicit choice is persisted;
// otherwise the browser's color preference remains authoritative.
export const THEME_BOOT_SCRIPT = `(()=>{let saved;try{saved=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}const root=document.documentElement;if(saved==='light'||saved==='dark')root.dataset.themePreference=saved;root.dataset.theme=root.dataset.themePreference||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')})()`
