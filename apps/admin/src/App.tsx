import { NavLink, Outlet, Route, Routes } from 'react-router';
import { ApiStatus } from './components/ApiStatus';
import { useAdminSession } from './lib/session-context';
import { Dashboard } from './pages/Dashboard';
import { DriverDetail } from './pages/DriverDetail';
import { Drivers } from './pages/Drivers';
import { Login } from './pages/Login';
import { Placeholder } from './pages/Placeholder';

/** Menú del panel (11.1, paso 3). */
const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/drivers', label: 'Conductores' },
  { to: '/users', label: 'Usuarios', phase: 'Fase 5' },
  { to: '/trips', label: 'Viajes', phase: 'Fase 3' },
  { to: '/fares', label: 'Tarifas', phase: 'Fase 5' },
  { to: '/audit', label: 'Auditoría', phase: 'Fase 5' },
] as const;

function Layout() {
  const { signOut } = useAdminSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">rideapp</div>
        <nav aria-label="Principal">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        <ApiStatus />
        <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  const { status } = useAdminSession();
  if (status === 'loading') return <div className="splash" aria-busy="true" />;
  if (status === 'signedOut') return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="drivers/:id" element={<DriverDetail />} />
        {NAV.filter((i) => 'phase' in i).map((item) => (
          <Route
            key={item.to}
            path={item.to.slice(1)}
            element={<Placeholder title={item.label} phase={'phase' in item ? item.phase : ''} />}
          />
        ))}
        <Route path="*" element={<Placeholder title="Página no encontrada" phase="—" />} />
      </Route>
    </Routes>
  );
}
