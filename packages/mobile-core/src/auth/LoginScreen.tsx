import { LoginRequest } from '@rideapp/contracts';
import { Button, TextField } from '@rideapp/ui';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { FormError, FormScreen } from './FormScreen';

export interface LoginScreenProps {
  onBack?: () => void;
  onRegister: () => void;
  onForgot: () => void;
}

export function LoginScreen({ onBack, onRegister, onForgot }: LoginScreenProps) {
  const { api, signIn } = useSession();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const parsed = LoginRequest.safeParse({ email, password });
    if (!parsed.success) {
      setError('Escribe tu email y tu contraseña.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(await api.auth.login(parsed.data));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormScreen
      onBack={onBack}
      title="Iniciar sesión"
      subtitle="Entra con el email y la contraseña de tu cuenta."
      footer={<Button label="¿No tienes cuenta? Crear una" variant="ghost" onPress={onRegister} />}
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <FormError message={error} />
      <Button label="Entrar" onPress={submit} loading={loading} />
      <Button label="¿Olvidaste tu contraseña?" variant="ghost" onPress={onForgot} />
    </FormScreen>
  );
}
