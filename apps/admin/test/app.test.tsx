import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { AdminSessionContext, type SessionStatus } from '../src/lib/session-context';

function renderAt(path: string, status: SessionStatus = 'signedIn') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminSessionContext.Provider value={{ status, signIn: vi.fn(), signOut: vi.fn() }}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AdminSessionContext.Provider>
    </QueryClientProvider>,
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App con sesión', () => {
  it('muestra el dashboard con los usuarios por rol y el estado del API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/admin/overview')
          ? json({ users: { passengers: 12, drivers: 3, admins: 1 } })
          : json({ status: 'ok', checks: {} }),
      ),
    );
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(await screen.findByText('12')).toBeTruthy();
    expect(await screen.findByText('API operativa')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
  });

  it('sin clave de Google muestra un aviso en lugar del mapa', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 503)),
    );
    renderAt('/');
    expect(screen.getByText(/Mapa desactivado/)).toBeTruthy();
  });

  it('las secciones pendientes indican su fase', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 503)),
    );
    renderAt('/drivers');
    expect(screen.getByText(/Fase 2/)).toBeTruthy();
  });
});

describe('App sin sesión', () => {
  it('muestra el login y, tras la contraseña, pide el código TOTP', async () => {
    const fetchMock = vi.fn(async () => json({ challengeId: 'reto-1', expiresIn: 300 }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/', 'signedOut');
    expect(screen.getByRole('heading', { name: 'Panel de administración' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'una-clave-larga' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByRole('heading', { name: 'Código de verificación' })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/auth/admin/login');
    expect(init.credentials).toBe('include');
  });

  it('muestra un error genérico si las credenciales no valen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'INVALID_CREDENTIALS', message: 'x' }, 401)),
    );
    renderAt('/', 'signedOut');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'mala' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Credenciales o código incorrectos.')).toBeTruthy();
  });
});
