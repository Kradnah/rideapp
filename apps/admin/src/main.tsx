import './zod-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AdminSessionProvider } from './lib/session';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AdminSessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AdminSessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
