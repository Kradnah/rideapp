import { ApiClientError } from '@rideapp/api-client';
import type { DriverAccount } from '@rideapp/contracts';
import { FormError, FormScreen, useSession } from '@rideapp/mobile-core';
import { Button, radius, spacing, usePalette } from '@rideapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { DRIVER_ACCOUNT_KEY, driverError, useDriverAccount } from '@/lib/driver-account';

const isForbidden = (err: unknown) => err instanceof ApiClientError && err.status === 403;

interface Step {
  title: string;
  detail: string;
  done: boolean;
  href: Href;
}

function steps(a: DriverAccount): Step[] {
  const vehicle = a.vehicles.find((v) => v.active);
  const docsLeft = a.missing.documents.length;
  return [
    {
      title: 'Tus datos',
      detail: a.licenseLast4 ? `Licencia ····${a.licenseLast4}` : 'Licencia y teléfono',
      done: !a.missing.profile,
      href: '/onboarding/profile',
    },
    {
      title: 'Tu vehículo',
      detail: vehicle
        ? `${vehicle.brand} ${vehicle.model} · ${vehicle.plate}`
        : 'Placa, marca y modelo',
      done: !a.missing.vehicle,
      href: '/onboarding/vehicle',
    },
    {
      title: 'Documentos',
      detail: docsLeft === 0 ? 'Licencia, tarjeta de propiedad y SOAT' : `Faltan ${docsLeft} de 3`,
      done: docsLeft === 0,
      href: '/onboarding/documents',
    },
  ];
}

function Banner({ account }: { account: DriverAccount }) {
  const p = usePalette();
  const content =
    account.status === 'PENDING' && account.submitted
      ? {
          color: p.pending,
          title: 'Solicitud en revisión',
          text: 'Revisaremos tus documentos lo antes posible. Esta pantalla se actualiza sola.',
        }
      : account.status === 'REJECTED'
        ? {
            color: p.down,
            title: 'Necesitamos que corrijas algo',
            text: account.statusReason ?? 'Revisa tus datos y vuelve a enviarlos.',
          }
        : account.status === 'SUSPENDED'
          ? {
              color: p.down,
              title: 'Cuenta suspendida',
              text: account.statusReason ?? 'Escríbenos para revisar tu caso.',
            }
          : null;
  if (!content) return null;
  return (
    <View accessibilityRole="summary" style={[styles.banner, { borderColor: content.color }]}>
      <Text style={[styles.bannerTitle, { color: content.color }]}>{content.title}</Text>
      <Text style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{content.text}</Text>
    </View>
  );
}

/** Registro del conductor (10.1): datos → vehículo → documentos → enviar a revisión. */
export default function OnboardingScreen() {
  const p = usePalette();
  const { api, signOut } = useSession();
  const queryClient = useQueryClient();
  const account = useDriverAccount();
  const submit = useMutation({
    mutationFn: () => api.drivers.submit(),
    onSuccess: (data) => queryClient.setQueryData(DRIVER_ACCOUNT_KEY, data),
  });

  const a = account.data;
  if (!a) {
    return (
      <FormScreen title="Tu registro como conductor">
        {account.isError && isForbidden(account.error) ? (
          <>
            <FormError message="Esta cuenta es de pasajero. Para conducir, crea una cuenta de conductor con otro email." />
            <Button label="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
          </>
        ) : account.isError ? (
          <>
            <FormError message={driverError(account.error)} />
            <Button label="Reintentar" onPress={() => void account.refetch()} />
          </>
        ) : (
          <ActivityIndicator color={p.accent} />
        )}
      </FormScreen>
    );
  }

  const editable = a.status === null || a.status === 'PENDING' || a.status === 'REJECTED';
  const waiting = a.status === 'PENDING' && a.submitted;
  const complete = steps(a).every((s) => s.done);

  return (
    <FormScreen
      title="Tu registro como conductor"
      subtitle="Completa estos pasos y envíalos a revisión. Tus documentos solo los ve el equipo de rideapp."
      footer={
        a.status === 'APPROVED' ? (
          <Button label="Empezar a conducir" onPress={() => router.replace('/')} />
        ) : editable && !waiting ? (
          <>
            <FormError message={submit.isError ? driverError(submit.error) : null} />
            <Button
              label="Enviar a revisión"
              onPress={() => submit.mutate()}
              loading={submit.isPending}
              disabled={!complete}
              accessibilityHint={complete ? undefined : 'Completa los tres pasos primero'}
            />
          </>
        ) : (
          <Button label="Mi perfil" variant="secondary" onPress={() => router.push('/profile')} />
        )
      }
    >
      <Banner account={a} />
      {a.status === 'APPROVED' && (
        <View accessibilityRole="summary" style={[styles.banner, { borderColor: p.ok }]}>
          <Text style={[styles.bannerTitle, { color: p.ok }]}>¡Cuenta aprobada!</Text>
          <Text style={{ color: p.text, fontSize: 14 }}>Ya puedes ponerte en línea.</Text>
        </View>
      )}
      {steps(a).map((step, i) => (
        <Pressable
          key={step.title}
          accessibilityRole="button"
          accessibilityState={{ disabled: !editable || waiting }}
          accessibilityLabel={`Paso ${i + 1}: ${step.title}. ${step.done ? 'Completo' : 'Pendiente'}`}
          disabled={!editable || waiting}
          onPress={() => router.push(step.href)}
          style={({ pressed }) => [
            styles.step,
            { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View
            style={[
              styles.badge,
              {
                backgroundColor: step.done ? p.ok : 'transparent',
                borderColor: step.done ? p.ok : p.border,
              },
            ]}
          >
            <Text style={{ color: step.done ? p.surface : p.textMuted, fontWeight: '700' }}>
              {step.done ? '✓' : i + 1}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text style={[styles.stepTitle, { color: p.text }]}>{step.title}</Text>
            <Text style={{ color: p.textMuted, fontSize: 13 }}>{step.detail}</Text>
          </View>
          {editable && !waiting && <Text style={{ color: p.textMuted, fontSize: 20 }}>›</Text>}
        </Pressable>
      ))}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: { fontSize: 16, fontWeight: '600' },
});
