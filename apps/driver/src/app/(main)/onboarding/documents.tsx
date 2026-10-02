import type { DriverDocumentType } from '@rideapp/contracts';
import { FormError, FormScreen, useSession } from '@rideapp/mobile-core';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DRIVER_ACCOUNT_KEY, driverError, useDriverAccount } from '@/lib/driver-account';

const DOCUMENTS: { type: DriverDocumentType; title: string; hint: string }[] = [
  {
    type: 'DRIVER_LICENSE',
    title: 'Licencia de conducción',
    hint: 'Por el lado de la foto, que se lea el número.',
  },
  {
    type: 'VEHICLE_REGISTRATION',
    title: 'Tarjeta de propiedad',
    hint: 'La del vehículo que registraste.',
  },
  { type: 'SOAT', title: 'SOAT vigente', hint: 'Foto del certificado o captura del SOAT digital.' },
];

/** Comprime antes de subir (10.1, paso 1): ~1600 px y JPEG al 70 % caben de sobra en 5 MB. */
async function compress(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1600 });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return result.uri;
}

/** Paso 3: documentos. El servidor valida el tipo real y elimina los metadatos (EXIF). */
export default function DocumentsStep() {
  const p = usePalette();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const account = useDriverAccount();
  const [uploading, setUploading] = useState<DriverDocumentType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async ({ type, uri }: { type: DriverDocumentType; uri: string }) => {
      const form = new FormData();
      // El fetch global de Expo (expo/fetch) no acepta el `{ uri, name, type }` de React Native:
      // `File` de expo-file-system implementa Blob y se adjunta tal cual.
      form.append('file', new File(uri));
      return api.drivers.uploadDocument(type, form);
    },
    onSettled: () => {
      setUploading(null);
      void queryClient.invalidateQueries({ queryKey: DRIVER_ACCOUNT_KEY });
    },
  });

  const pick = async (type: DriverDocumentType, source: 'camera' | 'library') => {
    setNotice(null);
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice(
        source === 'camera'
          ? 'Permite el uso de la cámara para tomar la foto.'
          : 'Permite el acceso a tus fotos.',
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setUploading(type);
    try {
      upload.mutate({ type, uri: await compress(asset.uri) });
    } catch {
      setUploading(null);
      setNotice('No pudimos procesar esa imagen. Prueba con otra.');
    }
  };

  const uploaded = new Set(account.data?.documents.map((d) => d.type));
  const complete = DOCUMENTS.every((d) => uploaded.has(d.type));

  return (
    <FormScreen
      title="Documentos"
      subtitle="Fotos nítidas, sin reflejos y con los cuatro bordes visibles. Se guardan cifradas."
      onBack={() => router.back()}
      footer={
        <Button
          label={complete ? 'Listo' : 'Volver'}
          variant={complete ? 'primary' : 'secondary'}
          onPress={() => router.back()}
        />
      }
    >
      {DOCUMENTS.map((doc) => {
        const done = uploaded.has(doc.type);
        const busy = uploading === doc.type;
        return (
          <View
            key={doc.type}
            style={[
              styles.card,
              { borderColor: done ? p.ok : p.border, backgroundColor: p.surface },
            ]}
          >
            <View style={styles.header}>
              <Text style={[styles.title, { color: p.text }]}>{doc.title}</Text>
              <Text style={{ color: done ? p.ok : p.textMuted, fontWeight: '600', fontSize: 13 }}>
                {busy ? 'Subiendo…' : done ? '✓ Subido' : 'Pendiente'}
              </Text>
            </View>
            <Text style={{ color: p.textMuted, fontSize: 13 }}>{doc.hint}</Text>
            <View style={styles.buttons}>
              <View style={styles.flex}>
                <Button
                  label={done ? 'Repetir foto' : 'Tomar foto'}
                  variant="secondary"
                  disabled={uploading !== null}
                  loading={busy}
                  onPress={() => void pick(doc.type, 'camera')}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label="Galería"
                  variant="ghost"
                  disabled={uploading !== null}
                  onPress={() => void pick(doc.type, 'library')}
                />
              </View>
            </View>
          </View>
        );
      })}
      <FormError message={notice ?? (upload.isError ? driverError(upload.error) : null)} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
