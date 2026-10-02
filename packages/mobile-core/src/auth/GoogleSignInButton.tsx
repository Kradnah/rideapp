import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { ApiClientError } from '@rideapp/api-client';
import { CURRENT_POLICY_VERSION, type SelfAssignableRole } from '@rideapp/contracts';
import { Button, Checkbox, radius, spacing, usePalette } from '@rideapp/ui';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { PRIVACY_POLICY } from './privacy-policy';

export interface GoogleSignInButtonProps {
  /** Client ID "Aplicación web" de Google (no es secreto). */
  webClientId: string;
  role: SelfAssignableRole;
  /** Se muestra bajo los botones de la bienvenida. */
  onError: (message: string | null) => void;
}

let configuredFor: string | null = null;

function configure(webClientId: string) {
  if (configuredFor === webClientId) return;
  // Solo openid, email y profile: nada más (8.2).
  GoogleSignin.configure({ webClientId, scopes: ['email', 'profile'] });
  configuredFor = webClientId;
}

/**
 * "Continuar con Google" (9.1, paso 3). Si la cuenta es nueva, el API responde CONSENT_REQUIRED
 * y se pide la autorización de datos antes de crearla, reutilizando el mismo idToken.
 */
export function GoogleSignInButton({ webClientId, role, onError }: GoogleSignInButtonProps) {
  const p = usePalette();
  const { api, signIn } = useSession();
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  const finish = async (idToken: string, withConsent: boolean) => {
    try {
      const pair = await api.auth.google({
        idToken,
        role,
        ...(withConsent && {
          consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
        }),
      });
      setPendingToken(null);
      await signIn(pair);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'CONSENT_REQUIRED' && !withConsent) {
        setAccepted(false);
        setPendingToken(idToken);
        return;
      }
      setPendingToken(null);
      await GoogleSignin.signOut().catch(() => undefined);
      onError(
        err instanceof ApiClientError && err.code === 'CONFLICT'
          ? 'Ya tienes una cuenta con ese email. Inicia sesión con tu contraseña.'
          : friendlyError(err),
      );
    }
  };

  const start = async () => {
    onError(null);
    setLoading(true);
    try {
      configure(webClientId);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      if (!isSuccessResponse(res)) return; // cancelado por el usuario
      if (!res.data.idToken) {
        onError('Google no devolvió la identificación. Inténtalo de nuevo.');
        return;
      }
      await finish(res.data.idToken, false);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return;
      onError(
        code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE
          ? 'Este teléfono no tiene los servicios de Google Play.'
          : 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  };

  const confirmConsent = async () => {
    if (!pendingToken || !accepted) return;
    setLoading(true);
    await finish(pendingToken, true);
    setLoading(false);
  };

  return (
    <>
      <Button label="Continuar con Google" variant="secondary" onPress={start} loading={loading} />
      <Modal
        visible={pendingToken !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPendingToken(null)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: p.surface }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
              Antes de crear tu cuenta
            </Text>
            <Checkbox checked={accepted} onChange={setAccepted}>
              <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>
                Autorizo el tratamiento de mis datos personales según la{' '}
                <Text
                  accessibilityRole="link"
                  onPress={() => setShowPolicy((v) => !v)}
                  style={{ color: p.accent, textDecorationLine: 'underline', fontWeight: '600' }}
                >
                  Política de Tratamiento de la Información
                </Text>
                .
              </Text>
            </Checkbox>
            {showPolicy ? (
              <ScrollView style={[styles.policy, { borderColor: p.border }]}>
                {PRIVACY_POLICY.sections.map((s) => (
                  <View key={s.title} style={{ gap: 2, marginBottom: spacing.md }}>
                    <Text style={{ color: p.text, fontWeight: '600' }}>{s.title}</Text>
                    <Text style={{ color: p.textMuted, lineHeight: 20 }}>{s.body}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <Button
              label="Crear cuenta"
              onPress={confirmConsent}
              disabled={!accepted}
              loading={loading}
            />
            <Button label="Cancelar" variant="ghost" onPress={() => setPendingToken(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    padding: spacing.xl,
    gap: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  title: { fontSize: 20, fontWeight: '700' },
  policy: { maxHeight: 280, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
});
