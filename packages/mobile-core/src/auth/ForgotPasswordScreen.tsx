import { ApiClientError } from '@rideapp/api-client';
import { Email, EmailCode, PASSWORD_MIN_LENGTH, Password } from '@rideapp/contracts';
import { Button, TextField, usePalette } from '@rideapp/ui';
import { useState } from 'react';
import { Text } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { FormError, FormScreen } from './FormScreen';

export interface ForgotPasswordScreenProps {
  onBack?: () => void;
  /** Tras cambiar la contraseña: volver al login. */
  onDone: () => void;
}

/**
 * Recuperación de contraseña (8.2): email → código de 6 dígitos por correo → contraseña nueva.
 * El servidor responde igual exista o no la cuenta, así que la app tampoco lo distingue.
 */
export function ForgotPasswordScreen({ onBack, onDone }: ForgotPasswordScreenProps) {
  const p = usePalette();
  const { api } = useSession();
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    const parsed = Email.safeParse(email);
    if (!parsed.success) {
      setError('Escribe un email válido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.forgotPassword({ email: parsed.data });
      setStep('code');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!EmailCode.safeParse(code).success) {
      setError('El código tiene 6 dígitos.');
      return;
    }
    if (!Password.safeParse(password).success) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.resetPassword({ email: Email.parse(email), code, password });
      setStep('done');
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.code === 'INVALID_CODE'
          ? 'Código incorrecto o caducado. Revisa el correo o pide otro.'
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <FormScreen
        title="Contraseña actualizada"
        subtitle="Cerramos tus sesiones abiertas por seguridad. Ya puedes entrar con la contraseña nueva."
      >
        <Button label="Iniciar sesión" onPress={onDone} />
      </FormScreen>
    );
  }

  if (step === 'code') {
    return (
      <FormScreen
        onBack={() => setStep('email')}
        title="Revisa tu correo"
        subtitle={`Si ${email.trim()} tiene una cuenta, te enviamos un código de 6 dígitos. Caduca en 30 minutos.`}
      >
        <TextField
          label="Código"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
        />
        <TextField
          label="Contraseña nueva"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres.`}
        />
        <FormError message={error} />
        <Button label="Cambiar contraseña" onPress={reset} loading={busy} />
        <Button label="No me llegó: pedir otro código" variant="ghost" onPress={requestCode} />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      onBack={onBack}
      title="¿Olvidaste tu contraseña?"
      subtitle="Escribe el email de tu cuenta y te enviaremos un código para elegir una nueva."
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <FormError message={error} />
      <Button label="Enviar código" onPress={requestCode} loading={busy} />
      <Text style={{ color: p.textMuted, fontSize: 13 }}>
        Si entraste con Google, usa "Continuar con Google": esas cuentas no tienen contraseña.
      </Text>
    </FormScreen>
  );
}
