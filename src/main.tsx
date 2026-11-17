import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { QuotePublicPage } from './pages/QuotePublicPage.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

// /q/<token> is the public page for the client (no login). Everything else is Yaal's app.
const quoteMatch = window.location.pathname.match(/^\/q\/([A-Za-z0-9_-]+)\/?$/);

createRoot(root).render(
  <StrictMode>{quoteMatch?.[1] ? <QuotePublicPage token={quoteMatch[1]} /> : <App />}</StrictMode>,
);
