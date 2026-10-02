import { ApiClientError } from '@rideapp/api-client';
import { type FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { useAdminSession } from '../lib/session-context';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Credenciales o código incorrectos.',
  RATE_LIMITED: 'Demasiados intentos. Espera unos minutos.',
  UNAUTHORIZED: 'El acceso caducó. Vuelve a introducir tu contraseña.',
  NETWORK_ERROR: 'No hay conexión con el servidor.',
};

const message = (err: unknown) =>
  (err instanceof ApiClientError && MESSAGES[err.code]) || 'No se pudo iniciar sesión.';

/** Login del panel en dos pasos: contraseña y código TOTP (11.1, paso 1). */
export function Login() {
  const { signIn } = useAdminSession();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.login({ email, password });
      setPassword('');
      setChallengeId(res.challengeId);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.admin.verifyTotp(challengeId, code);
      signIn(session.accessToken);
    } catch (err) {
      setCode('');
      if (
        err instanceof ApiClientError &&
        (err.code === 'UNAUTHORIZED' || err.code === 'RATE_LIMITED')
      ) {
        setChallengeId(null);
      }
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <section className="card login__card">
        <div className="brand">rideapp</div>
        {challengeId === null ? (
          <form onSubmit={submitPassword} className="form">
            <h1>Panel de administración</h1>
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="form__error">
                {error}
              </p>
            ) : null}
            <button className="btn" disabled={busy}>
              {busy ? 'Comprobando…' : 'Continuar'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="form">
            <h1>Código de verificación</h1>
            <p className="muted">Escribe el código de 6 dígitos de tu app de autenticación.</p>
            <label>
              Código
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {error ? (
              <p role="alert" className="form__error">
                {error}
              </p>
            ) : null}
            <button className="btn" disabled={busy || code.length !== 6}>
              {busy ? 'Verificando…' : 'Entrar'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setChallengeId(null)}>
              Volver
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
