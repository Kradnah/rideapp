import { Link } from 'react-router';

export function NotFound() {
  return (
    <>
      <header className="page-header">
        <h1>Página no encontrada</h1>
      </header>
      <section className="card card--muted">
        <p>
          Esta dirección no existe. <Link to="/">Volver al dashboard</Link>.
        </p>
      </section>
    </>
  );
}
