import { type Me, UpdateMeRequest } from '@rideapp/contracts';
import { Button, spacing, TextField, usePalette } from '@rideapp/ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { FormError, FormScreen } from './FormScreen';

export interface ProfileShortcut {
  label: string;
  onPress: () => void;
}

export interface ProfileScreenProps {
  onBack?: () => void;
  /** Accesos de la app (Mis viajes, Ganancias…), arriba del formulario. */
  shortcuts?: ProfileShortcut[];
  onOpenPolicy: () => void;
  /** "Tus datos y tu cuenta": descargar los datos y eliminar la cuenta (9.6). */
  onOpenAccountData: () => void;
  onVerifyEmail: () => void;
}

/** Perfil (9.6): editar nombre y teléfono, tus datos, política y cerrar sesión. */
export function ProfileScreen({
  onBack,
  shortcuts = [],
  onOpenPolicy,
  onOpenAccountData,
  onVerifyEmail,
}: ProfileScreenProps) {
  const p = usePalette();
  const { api, signOut, signOutAll } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.me
      .get()
      .then((data) => {
        if (!active) return;
        setMe(data);
        setFullName(data.fullName);
        setPhone(data.phone ?? '');
      })
      .catch((err: unknown) => {
        if (active) setError(friendlyError(err));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const save = async () => {
    setSaved(false);
    const normalizedPhone = phone.replace(/[\s-]/g, '');
    const parsed = UpdateMeRequest.safeParse({
      fullName,
      phone: normalizedPhone === '' ? null : normalizedPhone,
    });
    if (!parsed.success) {
      setError('Revisa el nombre y el teléfono (formato +57 300 123 4567).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setMe(await api.me.update(parsed.data));
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmSignOutAll = () =>
    Alert.alert(
      'Cerrar sesión en todos los dispositivos',
      'Tendrás que volver a iniciar sesión en cada teléfono donde uses rideapp.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar todas',
          style: 'destructive',
          onPress: () => void signOutAll().catch((err) => setError(friendlyError(err))),
        },
      ],
    );

  if (!me && !error) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}
      >
        <ActivityIndicator color={p.accent} />
      </View>
    );
  }

  return (
    <FormScreen
      onBack={onBack}
      title="Tu perfil"
      subtitle={me?.email ?? undefined}
      footer={
        <>
          <Button label="Tus datos y tu cuenta" variant="ghost" onPress={onOpenAccountData} />
          <Button label="Política de tratamiento de datos" variant="ghost" onPress={onOpenPolicy} />
          <Button label="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
          <Button
            label="Cerrar sesión en todos los dispositivos"
            variant="danger"
            onPress={confirmSignOutAll}
          />
        </>
      }
    >
      {shortcuts.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          {shortcuts.map((s) => (
            <Button key={s.label} label={s.label} variant="secondary" onPress={s.onPress} />
          ))}
        </View>
      )}
      {me?.email && !me.emailVerified ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: p.pending,
            borderRadius: 10,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>
            Tu email todavía no está verificado. Verificarlo protege tu cuenta y te permite
            recuperarla si olvidas la contraseña.
          </Text>
          <Button label="Verificar email" variant="secondary" onPress={onVerifyEmail} />
        </View>
      ) : null}
      <TextField
        label="Nombre completo"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
      />
      <TextField
        label="Teléfono"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="+57 300 123 4567"
        hint="Solo se comparte con tu conductor o pasajero durante un viaje."
      />
      <FormError message={error} />
      {saved ? (
        <Text accessibilityLiveRegion="polite" style={{ color: p.ok, fontSize: 14 }}>
          Cambios guardados.
        </Text>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        <Button label="Guardar cambios" onPress={save} loading={saving} />
      </View>
    </FormScreen>
  );
}
