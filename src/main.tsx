import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/vietnamese-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/vietnamese-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/vietnamese-600.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/vietnamese-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/space-grotesk/vietnamese-700.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { App } from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
