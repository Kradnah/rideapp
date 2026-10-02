import { ApiClientError } from '@rideapp/api-client';
import { EmailCode } from '@rideapp/contracts';
import { Button, TextField, usePalette } from '@rideapp/ui';
import { useState } from 'react';
import { Text } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { FormError, FormScreen } from './FormScreen';

export interface VerifyEmailScreenProps {
  email: string | null;
  onBack?: () => void;
  onVerified: () => void;
}

/** Verificación del email con el código de 6 dígitos (8.2, paso 6). */
export function VerifyEmailScreen({ email, onBack, onVerified }: VerifyEmailScreenProps) {
  const p = usePalette();
  const { api } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    if (!EmailCode.safeParse(code).success) {
      setError('El código tiene 6 dígitos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyEmail(code);
      onVerified();
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.code === 'INVALID_CODE'
          ? 'Código incorrecto o caducado. Pide uno nuevo si hace falta.'
          : friendlyError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    try {
      await api.auth.requestEmailVerification();
      setNotice('Te enviamos un código nuevo.');
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <FormScreen
      onBack={onBack}
      title="Verifica tu email"
      subtitle={`Escribe el código de 6 dígitos que enviamos a ${email ?? 'tu correo'}.`}
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
      <FormError message={error} />
      {notice ? <Text style={{ color: p.ok, fontSize: 14 }}>{notice}</Text> : null}
      <Button label="Verificar" onPress={verify} loading={busy} />
      <Button label="Enviar un código nuevo" variant="ghost" onPress={resend} />
    </FormScreen>
  );
}
