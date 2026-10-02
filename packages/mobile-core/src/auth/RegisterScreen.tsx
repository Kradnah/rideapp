import {
  CURRENT_POLICY_VERSION,
  PASSWORD_MIN_LENGTH,
  RegisterRequest,
  type SelfAssignableRole,
} from '@rideapp/contracts';
import { Button, Checkbox, TextField, usePalette } from '@rideapp/ui';
import { useRef, useState } from 'react';
import { Text, type TextInput } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { FormError, FormScreen } from './FormScreen';

export interface RegisterScreenProps {
  onBack?: () => void;
  role: SelfAssignableRole;
  onLogin: () => void;
  onOpenPolicy: () => void;
}

type FieldErrors = Partial<Record<'fullName' | 'email' | 'password' | 'consent', string>>;

/** Registro con autorización de datos expresa y casilla no premarcada (15, 15.2). */
export function RegisterScreen({ onBack, role, onLogin, onOpenPolicy }: RegisterScreenProps) {
  const p = usePalette();
  const { api, signIn } = useSession();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed = RegisterRequest.safeParse({
      fullName,
      email,
      password,
      role,
      consent: accepted ? { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION } : undefined,
    });
    if (!parsed.success) {
      const errs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'fullName') errs.fullName = 'Escribe tu nombre (al menos 2 letras).';
        if (field === 'email') errs.email = 'Escribe un email válido.';
        if (field === 'password')
          errs.password = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
        if (field === 'consent') errs.consent = 'Debes aceptar la política para crear la cuenta.';
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      await signIn(await api.auth.register(parsed.data));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormScreen
      onBack={onBack}
      title="Crear cuenta"
      subtitle={
        role === 'DRIVER' ? 'Regístrate para conducir con rideapp.' : 'Pide viajes en minutos.'
      }
      footer={<Button label="¿Ya tienes cuenta? Inicia sesión" variant="ghost" onPress={onLogin} />}
    >
      <TextField
        label="Nombre completo"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        error={fieldErrors.fullName}
      />
      <TextField
        ref={emailRef}
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={fieldErrors.email}
      />
      <TextField
        ref={passwordRef}
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres. Una frase de varias palabras es fácil de recordar y difícil de adivinar.`}
        error={fieldErrors.password}
      />
      <Checkbox checked={accepted} onChange={setAccepted} error={fieldErrors.consent}>
        <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>
          Autorizo el tratamiento de mis datos personales según la{' '}
          <Text
            accessibilityRole="link"
            onPress={onOpenPolicy}
            style={{ color: p.accent, textDecorationLine: 'underline', fontWeight: '600' }}
          >
            Política de Tratamiento de la Información
          </Text>
          .
        </Text>
      </Checkbox>
      <FormError message={error} />
      <Button label="Crear cuenta" onPress={submit} loading={loading} />
    </FormScreen>
  );
}
