import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/patrick-hand/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Preview } from './app/Preview';
import './styles/tokens.css';
import './app/preview.css';

// The UI theme: the visitor's last choice, else the system's.
let saved: string | null = null;
try {
  saved = localStorage.getItem('esquadro.ui-theme');
} catch {
  /* storage blocked */
}
document.documentElement.dataset.theme =
  saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
