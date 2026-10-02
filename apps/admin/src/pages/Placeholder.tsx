export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
      </header>
      <section className="card card--muted">
        <p>Se construye en la {phase} del plan.</p>
      </section>
    </>
  );
}
