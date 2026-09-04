import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { disableAllConsole } from './lib/logger';

disableAllConsole();

function AppWrapper() {
  useEffect(() => {
    // Dismiss after first paint via requestAnimationFrame
    requestAnimationFrame(() => {
      (window as any).__dismissLoader?.();
    });
  }, []);

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWrapper />
  </StrictMode>
);
