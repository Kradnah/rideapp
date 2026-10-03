import { DELETE_ACCOUNT_CONFIRMATION, type Me } from '@rideapp/contracts';
import { Button, spacing, TextField, usePalette } from '@rideapp/ui';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { friendlyError } from './errors';
import { FormError, FormScreen } from './FormScreen';

export interface AccountDataScreenProps {
  onBack: () => void;
  onOpenPolicy: () => void;
  /** Texto extra para el conductor (documentos, ganancias…). */
  roleNote?: string;
}

const DELETE_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'La contraseña no es correcta.',
  CONFLICT: 'Tienes un viaje en curso. Termínalo o cancélalo antes de eliminar la cuenta.',
};

/**
 * Tus datos y tu cuenta (9.6, 15.2): descargar los datos en JSON y eliminar la cuenta.
 * Eliminar pide escribir ELIMINAR y, si la cuenta tiene contraseña, la contraseña.
 */
export function AccountDataScreen({ onBack, onOpenPolicy, roleNote }: AccountDataScreenProps) {
  const p = usePalette();
  const { api, deleteAccount } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    api.me
      .get()
      .then((data) => active && setMe(data))
      .catch((err: unknown) => active && setError(friendlyError(err)));
    return () => {
      active = false;
    };
  }, [api]);

  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await api.me.export();
      // En la caché de la app: el sistema la limpia y no queda en la galería ni en Descargas.
      const file = new File(Paths.cache, `rideapp-mis-datos-${data.generatedAt.slice(0, 10)}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Guardar o enviar tus datos',
        });
      } else {
        Alert.alert('Datos listos', 'Este teléfono no permite compartir archivos.');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setExporting(false);
    }
  };

  const canDelete =
    confirmation.trim().toUpperCase() === DELETE_ACCOUNT_CONFIRMATION &&
    (!me?.hasPassword || password.length > 0);

  const confirmDelete = () =>
    Alert.alert(
      '¿Eliminar tu cuenta?',
      'No se puede deshacer. Se cerrará la sesión en todos tus dispositivos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => void remove() },
      ],
    );

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount({
        confirmation: DELETE_ACCOUNT_CONFIRMATION,
        ...(me?.hasPassword ? { password } : {}),
      });
      // La sesión se cierra y el layout lleva a la bienvenida.
    } catch (err) {
      const code = (err as { code?: string }).code;
      setDeleteError((code && DELETE_MESSAGES[code]) ?? friendlyError(err));
      setDeleting(false);
    }
  };

  if (!me && !error) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}
      >
        <ActivityIndicator color={p.accent} />
      </View>
    );
  }

  const body = { color: p.text, fontSize: 15, lineHeight: 22 } as const;
  const heading = { color: p.text, fontSize: 18, fontWeight: '700' } as const;

  return (
    <FormScreen
      onBack={onBack}
      title="Tus datos y tu cuenta"
      footer={
        <Button label="Política de tratamiento de datos" variant="ghost" onPress={onOpenPolicy} />
      }
    >
      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={heading}>
          Descargar mis datos
        </Text>
        <Text style={body}>
          Un archivo con tu perfil, tus autorizaciones, tus sesiones, tus viajes y tus
          calificaciones. Guárdalo en un lugar seguro: contiene datos personales.
        </Text>
        <Button
          label="Descargar mis datos"
          variant="secondary"
          onPress={() => void download()}
          loading={exporting}
        />
        <FormError message={error} />
      </View>

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Text accessibilityRole="header" style={heading}>
          Eliminar mi cuenta
        </Text>
        <Text style={body}>
          Borramos tu nombre, email, teléfono y formas de entrar. Los viajes se conservan sin datos
          que te identifiquen, con el origen y el destino aproximados, solo el tiempo que exige la
          ley.
          {roleNote ? ` ${roleNote}` : ''}
        </Text>
        <TextField
          label={`Escribe ${DELETE_ACCOUNT_CONFIRMATION} para confirmar`}
          value={confirmation}
          onChangeText={setConfirmation}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {me?.hasPassword ? (
          <TextField
            label="Tu contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
        ) : null}
        <FormError message={deleteError} />
        <Button
          label="Eliminar mi cuenta"
          variant="danger"
          onPress={confirmDelete}
          disabled={!canDelete}
          loading={deleting}
        />
      </View>
    </FormScreen>
  );
}
