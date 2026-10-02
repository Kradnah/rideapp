import { type Vehicle, type VehicleCategory, VehicleRequest } from '@rideapp/contracts';
import { FormError, FormScreen, useSession } from '@rideapp/mobile-core';
import { Button, radius, spacing, TextField, usePalette } from '@rideapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { DRIVER_ACCOUNT_KEY, driverError, useDriverAccount } from '@/lib/driver-account';

const CATEGORIES: { value: VehicleCategory; label: string; plate: string }[] = [
  { value: 'STANDARD', label: 'Carro', plate: 'ABC123' },
  { value: 'MOTO', label: 'Moto', plate: 'ABC12D' },
];

type Field = 'plate' | 'brand' | 'model' | 'color' | 'year';

function VehicleRow({ vehicle, onDelete }: { vehicle: Vehicle; onDelete: () => void }) {
  const p = usePalette();
  return (
    <View style={[styles.vehicle, { borderColor: p.border, backgroundColor: p.surface }]}>
      <View style={styles.flex}>
        <Text style={{ color: p.text, fontWeight: '700', letterSpacing: 1 }}>{vehicle.plate}</Text>
        <Text style={{ color: p.textMuted, fontSize: 13 }}>
          {vehicle.brand} {vehicle.model} · {vehicle.color} · {vehicle.year}
          {vehicle.active ? ' · activo' : ''}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Quitar ${vehicle.plate}`}
        hitSlop={8}
        onPress={onDelete}
      >
        <Text style={{ color: p.down, fontWeight: '600' }}>Quitar</Text>
      </Pressable>
    </View>
  );
}

/** Paso 2: vehículo con el que trabajará (placa colombiana según la categoría). */
export default function VehicleStep() {
  const p = usePalette();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const account = useDriverAccount();
  const [category, setCategory] = useState<VehicleCategory>('STANDARD');
  const [form, setForm] = useState<Record<Field, string>>({
    plate: '',
    brand: '',
    model: '',
    color: '',
    year: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: DRIVER_ACCOUNT_KEY });
  const add = useMutation({
    mutationFn: (body: VehicleRequest) => api.drivers.addVehicle(body),
    onSuccess: async () => {
      await refresh();
      router.back();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.drivers.deleteVehicle(id),
    onSuccess: refresh,
  });

  const set = (field: Field) => (value: string) => setForm((f) => ({ ...f, [field]: value }));

  const submit = () => {
    const parsed = VehicleRequest.safeParse({
      ...form,
      year: Number.parseInt(form.year, 10),
      category,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??=
          field === 'plate'
            ? `Placa no válida: ${CATEGORIES.find((c) => c.value === category)!.plate}`
            : field === 'year'
              ? 'Año no válido'
              : 'Completa este campo';
      }
      setErrors(next);
      return;
    }
    setErrors({});
    add.mutate(parsed.data);
  };

  const vehicles = account.data?.vehicles ?? [];

  return (
    <FormScreen
      title="Tu vehículo"
      subtitle="Debe coincidir con la tarjeta de propiedad que subirás después."
      onBack={() => router.back()}
      footer={<Button label="Agregar vehículo" onPress={submit} loading={add.isPending} />}
    >
      {vehicles.map((v) => (
        <VehicleRow
          key={v.id}
          vehicle={v}
          onDelete={() =>
            Alert.alert('Quitar vehículo', `¿Quitar ${v.plate}?`, [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Quitar', style: 'destructive', onPress: () => remove.mutate(v.id) },
            ])
          }
        />
      ))}

      <View accessibilityRole="radiogroup" style={styles.segment}>
        {CATEGORIES.map((c) => {
          const selected = c.value === category;
          return (
            <Pressable
              key={c.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setCategory(c.value)}
              style={[
                styles.segmentItem,
                {
                  borderColor: selected ? p.accent : p.border,
                  backgroundColor: selected ? p.accent : p.surface,
                },
              ]}
            >
              <Text style={{ color: selected ? p.onAccent : p.text, fontWeight: '600' }}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label="Placa"
        value={form.plate}
        onChangeText={set('plate')}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={CATEGORIES.find((c) => c.value === category)!.plate}
        error={errors.plate}
        maxLength={8}
      />
      <TextField
        label="Marca"
        value={form.brand}
        onChangeText={set('brand')}
        error={errors.brand}
        maxLength={40}
      />
      <TextField
        label="Modelo"
        value={form.model}
        onChangeText={set('model')}
        error={errors.model}
        maxLength={40}
      />
      <TextField
        label="Color"
        value={form.color}
        onChangeText={set('color')}
        error={errors.color}
        maxLength={30}
      />
      <TextField
        label="Año"
        value={form.year}
        onChangeText={set('year')}
        keyboardType="number-pad"
        error={errors.year}
        maxLength={4}
      />
      <FormError
        message={
          add.isError ? driverError(add.error) : remove.isError ? driverError(remove.error) : null
        }
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segmentItem: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
