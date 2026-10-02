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
          ? json({
              users: { passengers: 12, drivers: 3, admins: 1 },
              drivers: { pendingReview: 2, online: 1 },
            })
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
    renderAt('/users');
    expect(screen.getByText(/Fase 5/)).toBeTruthy();
  });
});

const DRIVER_ID = '0199a000-0000-7000-8000-000000000001';
const DOC_ID = '0199a000-0000-7000-8000-0000000000d1';

const detail = {
  userId: DRIVER_ID,
  fullName: 'Carlos Conductor',
  email: 'carlos@example.com',
  emailVerified: true,
  phoneMasked: '+57 *** *** 4567',
  licenseMasked: '****3456',
  status: 'PENDING',
  submitted: true,
  statusReason: null,
  submittedAt: '2026-10-02T10:00:00.000Z',
  reviewedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  vehicles: [
    {
      id: '0199a000-0000-7000-8000-0000000000a1',
      plate: 'ABC123',
      brand: 'Chevrolet',
      model: 'Spark',
      color: 'Blanco',
      year: 2018,
      category: 'STANDARD',
      active: true,
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  documents: [
    {
      id: DOC_ID,
      type: 'DRIVER_LICENSE',
      mime: 'image/jpeg',
      sizeBytes: 120_000,
      status: 'PENDING',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  missing: { profile: false, vehicle: false, documents: [] },
  availability: 'OFFLINE',
};

describe('Conductores', () => {
  it('la cola de revisión lista las solicitudes y enlaza al detalle', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/admin/drivers')
        ? json({
            items: [
              {
                userId: DRIVER_ID,
                fullName: 'Carlos Conductor',
                email: 'carlos@example.com',
                status: 'PENDING',
                submittedAt: '2026-10-02T10:00:00.000Z',
                createdAt: '2026-10-01T10:00:00.000Z',
                vehicle: { plate: 'ABC123', category: 'STANDARD' },
                documentCount: 3,
              },
            ],
            nextCursor: null,
          })
        : json({ status: 'ok', checks: {} }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/drivers');
    const link = await screen.findByRole('link', { name: 'Carlos Conductor' });
    expect(link.getAttribute('href')).toBe(`/drivers/${DRIVER_ID}`);
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(
      String(fetchMock.mock.calls.find(([u]) => String(u).includes('/admin/drivers'))![0]),
    ).toContain('status=PENDING');
  });

  it('detalle: datos enmascarados, revelar y aprobar', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url: String(url), method, body: init?.body as string | undefined });
        if (String(url).endsWith('/reveal')) return json({ value: '1070123456' });
        if (String(url).endsWith('/approve')) return new Response(null, { status: 204 });
        if (String(url).includes(`/admin/drivers/${DRIVER_ID}`)) return json(detail);
        return json({ status: 'ok', checks: {} });
      }),
    );
    renderAt(`/drivers/${DRIVER_ID}`);
    expect(await screen.findByRole('heading', { name: 'Carlos Conductor' })).toBeTruthy();
    expect(screen.getByText('****3456')).toBeTruthy();
    expect(screen.queryByText('1070123456')).toBeNull();

    // El segundo "Mostrar" es el de la licencia (el primero, el teléfono).
    fireEvent.click(screen.getAllByRole('button', { name: 'Mostrar' })[1]!);
    expect(await screen.findByText('1070123456')).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith('/reveal'))?.body).toBe(
      JSON.stringify({ field: 'licenseNumber' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/approve') && c.method === 'POST')).toBe(true),
    );
  });

  it('rechazar exige un motivo', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body as string | undefined });
        if (String(url).endsWith('/reject')) return new Response(null, { status: 204 });
        if (String(url).includes(`/admin/drivers/${DRIVER_ID}`)) return json(detail);
        return json({ status: 'ok', checks: {} });
      }),
    );
    renderAt(`/drivers/${DRIVER_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar…' }));
    const submit = screen.getByRole('button', { name: 'Rechazar' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo/), {
      target: { value: 'La foto de la licencia no se lee' },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await vi.waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/reject'))?.body).toBe(
        JSON.stringify({ reason: 'La foto de la licencia no se lee' }),
      ),
    );
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
