import { describe, expect, it } from 'vitest';
import {
  ApiError,
  computeFare,
  CreateTripRequest,
  CURRENT_POLICY_VERSION,
  DriverLocationV1,
  DriverOnboardingRequest,
  GIRARDOT_CENTER,
  IdempotencyKey,
  isInServiceAreaBounds,
  LatLng,
  LoginRequest,
  Money,
  QuoteRequest,
  RegisterRequest,
  roundFare,
  VehicleRequest,
} from '../src/index.js';

describe('LatLng', () => {
  it('acepta coordenadas válidas', () => {
    expect(LatLng.safeParse(GIRARDOT_CENTER).success).toBe(true);
  });
  it('rechaza latitudes y longitudes fuera de rango', () => {
    expect(LatLng.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(LatLng.safeParse({ lat: 0, lng: -181 }).success).toBe(false);
  });
});

describe('Money', () => {
  it('exige enteros no negativos', () => {
    expect(Money.safeParse({ amountCents: 850000, currency: 'COP' }).success).toBe(true);
    expect(Money.safeParse({ amountCents: 10.5, currency: 'COP' }).success).toBe(false);
    expect(Money.safeParse({ amountCents: -1, currency: 'COP' }).success).toBe(false);
    expect(Money.safeParse({ amountCents: 100, currency: 'cop' }).success).toBe(false);
  });
});

describe('RegisterRequest', () => {
  const base = {
    email: '  Ana@Example.COM ',
    password: 'una-clave-larga',
    fullName: 'Ana Pérez',
    role: 'PASSENGER',
    consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
  };

  it('normaliza el email', () => {
    expect(RegisterRequest.parse(base).email).toBe('ana@example.com');
  });
  it('nunca permite registrarse como ADMIN', () => {
    expect(RegisterRequest.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
  });
  it('exige al menos 10 caracteres de contraseña', () => {
    expect(RegisterRequest.safeParse({ ...base, password: 'corta' }).success).toBe(false);
  });
  it('rechaza campos desconocidos', () => {
    expect(RegisterRequest.safeParse({ ...base, isAdmin: true }).success).toBe(false);
  });
  it('exige aceptar los términos de forma expresa', () => {
    expect(RegisterRequest.safeParse({ ...base, consent: undefined }).success).toBe(false);
    expect(
      RegisterRequest.safeParse({
        ...base,
        consent: { acceptTerms: false, policyVersion: CURRENT_POLICY_VERSION },
      }).success,
    ).toBe(false);
  });
});

describe('LoginRequest', () => {
  it('no revela la política de longitud de contraseña', () => {
    expect(LoginRequest.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('roundFare', () => {
  it('redondea a múltiplos de 100 COP (10.000 centavos)', () => {
    expect(roundFare(0)).toBe(0);
    expect(roundFare(4_999)).toBe(0);
    expect(roundFare(5_000)).toBe(10_000);
    expect(roundFare(1_234_567)).toBe(1_230_000);
    expect(roundFare(1_235_000)).toBe(1_240_000);
  });
  it('rechaza importes negativos o no finitos', () => {
    expect(() => roundFare(-1)).toThrow(RangeError);
    expect(() => roundFare(Number.NaN)).toThrow(RangeError);
  });
});

describe('computeFare', () => {
  const rule = {
    baseCents: 300_000, // 3.000 COP
    perKmCents: 120_000, // 1.200 COP/km
    perMinCents: 20_000, // 200 COP/min
    minFareCents: 600_000, // 6.000 COP
  };

  it('aplica base + km + minutos y redondea', () => {
    // 3.000 + 4,25 km × 1.200 + 11 min × 200 = 3.000 + 5.100 + 2.200 = 10.300 COP
    expect(computeFare(rule, 4_250, 660)).toBe(1_030_000);
  });
  it('aplica la tarifa mínima', () => {
    expect(computeFare(rule, 500, 60)).toBe(600_000);
  });
  it('siempre devuelve un entero', () => {
    expect(Number.isInteger(computeFare(rule, 3_333, 333))).toBe(true);
  });
});

describe('zona de servicio', () => {
  it('Girardot está dentro y Bogotá fuera', () => {
    expect(isInServiceAreaBounds(GIRARDOT_CENTER)).toBe(true);
    expect(isInServiceAreaBounds({ lat: 4.711, lng: -74.0721 })).toBe(false);
  });
});

describe('DriverLocationV1', () => {
  it('rechaza campos extra', () => {
    const ok = { lat: 4.3, lng: -74.8, heading: 90, speed: 10, accuracy: 5, ts: Date.now() };
    expect(DriverLocationV1.safeParse(ok).success).toBe(true);
    expect(DriverLocationV1.safeParse({ ...ok, driverId: 'x' }).success).toBe(false);
  });
});

describe('ApiError', () => {
  it('solo acepta códigos conocidos', () => {
    expect(ApiError.safeParse({ code: 'NOT_FOUND', message: 'No existe' }).success).toBe(true);
    expect(ApiError.safeParse({ code: 'WHATEVER', message: '?' }).success).toBe(false);
  });
});

describe('VehicleRequest', () => {
  const car = {
    plate: 'abc 123',
    brand: 'Chevrolet',
    model: 'Spark',
    color: 'Blanco',
    year: 2018,
    category: 'STANDARD',
  };

  it('normaliza la placa (mayúsculas, sin espacios ni guiones)', () => {
    expect(VehicleRequest.parse(car).plate).toBe('ABC123');
    expect(VehicleRequest.parse({ ...car, plate: 'xyz-98a', category: 'MOTO' }).plate).toBe(
      'XYZ98A',
    );
  });
  it('exige el formato de placa de la categoría', () => {
    expect(VehicleRequest.safeParse({ ...car, plate: 'ABC12D' }).success).toBe(false);
    expect(VehicleRequest.safeParse({ ...car, category: 'MOTO' }).success).toBe(false);
    expect(VehicleRequest.safeParse({ ...car, plate: 'AB<12>' }).success).toBe(false);
  });
  it('rechaza años imposibles y campos desconocidos', () => {
    expect(VehicleRequest.safeParse({ ...car, year: 1950 }).success).toBe(false);
    expect(VehicleRequest.safeParse({ ...car, year: new Date().getFullYear() + 2 }).success).toBe(
      false,
    );
    expect(VehicleRequest.safeParse({ ...car, active: true }).success).toBe(false);
  });
});

describe('DriverOnboardingRequest', () => {
  it('normaliza la licencia y exige teléfono E.164', () => {
    const ok = DriverOnboardingRequest.parse({
      licenseNumber: ' 1070abc ',
      phone: '+573001234567',
    });
    expect(ok.licenseNumber).toBe('1070ABC');
    expect(
      DriverOnboardingRequest.safeParse({ licenseNumber: '12345', phone: '3001234567' }).success,
    ).toBe(false);
    expect(
      DriverOnboardingRequest.safeParse({ licenseNumber: '12 34', phone: '+573001234567' }).success,
    ).toBe(false);
  });
});

describe('QuoteRequest', () => {
  const base = { origin: GIRARDOT_CENTER, destination: { lat: 4.2955, lng: -74.788 } };
  it('limpia las direcciones (sin caracteres de control) y no acepta precio ni campos extra', () => {
    const ok = QuoteRequest.parse({ ...base, destinationAddress: '  Unicentro\n\u0007Girardot ' });
    expect(ok.destinationAddress).toBe('Unicentro  Girardot');
    expect(QuoteRequest.safeParse({ ...base, amountCents: 100 }).success).toBe(false);
    expect(QuoteRequest.safeParse({ ...base, originAddress: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('CreateTripRequest e IdempotencyKey', () => {
  it('solo el quoteId y el método de pago', () => {
    const quoteId = '0199a000-0000-7000-8000-000000000001';
    expect(CreateTripRequest.safeParse({ quoteId, paymentMethod: 'CASH' }).success).toBe(true);
    expect(
      CreateTripRequest.safeParse({ quoteId, paymentMethod: 'CASH', amountCents: 1 }).success,
    ).toBe(false);
    expect(CreateTripRequest.safeParse({ quoteId, paymentMethod: 'BITCOIN' }).success).toBe(false);
  });
  it('la clave de idempotencia es un identificador razonable', () => {
    expect(IdempotencyKey.safeParse('6f1c2d3e-4a5b-4c6d-8e7f-001122334455').success).toBe(true);
    expect(IdempotencyKey.safeParse('corta').success).toBe(false);
    expect(IdempotencyKey.safeParse('a'.repeat(16) + ' ;DROP').success).toBe(false);
  });
});
