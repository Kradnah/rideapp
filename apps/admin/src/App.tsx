import { NavLink, Outlet, Route, Routes } from 'react-router';
import { ApiStatus } from './components/ApiStatus';
import { useAdminSession } from './lib/session-context';
import { Audit } from './pages/Audit';
import { Dashboard } from './pages/Dashboard';
import { DriverDetail } from './pages/DriverDetail';
import { Drivers } from './pages/Drivers';
import { Fares } from './pages/Fares';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { Reports } from './pages/Reports';
import { TripDetail } from './pages/TripDetail';
import { Trips } from './pages/Trips';
import { UserDetail } from './pages/UserDetail';
import { Users } from './pages/Users';

/** Menú del panel (11.1, paso 3). */
const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/drivers', label: 'Conductores' },
  { to: '/users', label: 'Usuarios' },
  { to: '/trips', label: 'Viajes' },
  { to: '/fares', label: 'Tarifas' },
  { to: '/reports', label: 'Informes' },
  { to: '/audit', label: 'Auditoría' },
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
        <Route path="trips" element={<Trips />} />
        <Route path="trips/:id" element={<TripDetail />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:id" element={<UserDetail />} />
        <Route path="fares" element={<Fares />} />
        <Route path="reports" element={<Reports />} />
        <Route path="audit" element={<Audit />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
