import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Placeholder } from './app/Placeholder';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
);
