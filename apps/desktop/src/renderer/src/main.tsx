import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { OpersonaApi } from '../../preload/index';

declare global {
  interface Window { opersona: OpersonaApi }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
