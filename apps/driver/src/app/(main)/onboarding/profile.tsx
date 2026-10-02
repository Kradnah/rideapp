import { DriverOnboardingRequest } from '@rideapp/contracts';
import { FormError, FormScreen, useSession } from '@rideapp/mobile-core';
import { Button, TextField } from '@rideapp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { DRIVER_ACCOUNT_KEY, driverError } from '@/lib/driver-account';

/** Celular colombiano de 10 dígitos (3xx) → E.164. Acepta también un +57 ya escrito. */
function toE164(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  if (digits.length === 12 && digits.startsWith('57')) return `+${digits}`;
  return input.trim();
}

/** Paso 1: licencia de conducción y teléfono de contacto para los viajes. */
export default function DriverProfileStep() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });
  const [license, setLicense] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ license?: string; phone?: string }>({});

  const save = useMutation({
    mutationFn: (body: DriverOnboardingRequest) => api.drivers.saveProfile(body),
    onSuccess: (account) => {
      queryClient.setQueryData(DRIVER_ACCOUNT_KEY, account);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      router.back();
    },
  });

  const phoneValue = phone ?? me.data?.phone?.replace(/^\+57/, '') ?? '';

  const submit = () => {
    const parsed = DriverOnboardingRequest.safeParse({
      licenseNumber: license,
      phone: toE164(phoneValue),
    });
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
      setErrors({
        license: fields.has('licenseNumber')
          ? 'Escribe el número tal como aparece en la licencia.'
          : undefined,
        phone: fields.has('phone')
          ? 'Escribe un celular de 10 dígitos, p. ej. 3001234567.'
          : undefined,
      });
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <FormScreen
      title="Tus datos"
      subtitle="La licencia se guarda cifrada y solo la ve el equipo que revisa tu solicitud."
      onBack={() => router.back()}
      footer={<Button label="Guardar" onPress={submit} loading={save.isPending} />}
    >
      <TextField
        label="Número de licencia de conducción"
        value={license}
        onChangeText={setLicense}
        autoCapitalize="characters"
        autoCorrect={false}
        hint="Normalmente es tu número de cédula."
        error={errors.license}
        maxLength={20}
      />
      <TextField
        label="Celular"
        value={phoneValue}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        hint="El pasajero podrá contactarte durante el viaje."
        error={errors.phone}
        maxLength={16}
      />
      <FormError message={save.isError ? driverError(save.error) : null} />
    </FormScreen>
  );
}
