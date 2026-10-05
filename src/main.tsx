import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonty serwowane z własnej domeny: bez zapytań do Google Fonts (RODO) i zgodnie z CSP.
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/600.css';
import '@fontsource/schibsted-grotesk/700.css';
import '@fontsource/schibsted-grotesk/800.css';
import '@fontsource/jetbrains-mono/400.css';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
