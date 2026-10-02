import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('muestra el dashboard, el menú y el estado del API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ status: 'ok', checks: {} }), { status: 200 }),
      ),
    );
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Conductores' })).toBeTruthy();
    expect(await screen.findByText('API operativa')).toBeTruthy();
  });

  it('sin clave de Google muestra un aviso en lugar del mapa', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    renderAt('/');
    expect(screen.getByText(/Mapa desactivado/)).toBeTruthy();
  });

  it('indica cuando el API no responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    );
    renderAt('/');
    expect(await screen.findByText('API sin respuesta')).toBeTruthy();
  });

  it('las secciones pendientes indican su fase', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    renderAt('/drivers');
    expect(screen.getByText(/Fase 2/)).toBeTruthy();
  });
});
