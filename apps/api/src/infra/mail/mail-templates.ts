import type { MailMessage } from './mailer.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Primer nombre para el saludo; nunca HTML del usuario sin escapar. */
const greeting = (fullName: string) => fullName.trim().split(/\s+/)[0] || 'Hola';

const SECURITY_FOOTER =
  'Si no fuiste tú, ignora este correo. Nunca te pediremos este código por teléfono ni por chat.';

function layout(
  title: string,
  paragraphs: string[],
  code?: string,
  footer = SECURITY_FOOTER,
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('');
  const codeBlock = code
    ? `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">${code}</p>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,sans-serif;color:#16202a">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;color:#0f766e;font-size:22px;font-weight:700">rideapp</p>
<h1 style="margin:0 0 16px;font-size:20px">${title}</h1>${body}${codeBlock}
<p style="margin:24px 0 0;font-size:12px;color:#5b6875">${footer}</p>
</div></body></html>`;
}

/** Sin datos sensibles más allá del código (8.13, paso 2). */
export function verificationEmail(to: string, fullName: string, code: string): MailMessage {
  const name = escapeHtml(greeting(fullName));
  return {
    to,
    subject: `${code} es tu código de verificación de rideapp`,
    text: `Hola ${greeting(fullName)}:\n\nTu código para verificar tu email en rideapp es: ${code}\n\nCaduca en 24 horas. Si no creaste una cuenta, ignora este correo.`,
    html: layout(
      'Verifica tu email',
      [
        `Hola ${name}:`,
        'Escribe este código en la app para verificar tu email. Caduca en 24 horas.',
      ],
      code,
    ),
  };
}

export function passwordResetEmail(to: string, fullName: string, code: string): MailMessage {
  const name = escapeHtml(greeting(fullName));
  return {
    to,
    subject: `${code} es tu código para restablecer la contraseña`,
    text: `Hola ${greeting(fullName)}:\n\nTu código para restablecer la contraseña de rideapp es: ${code}\n\nCaduca en 30 minutos. Si no lo pediste, ignora este correo: tu contraseña no cambia.`,
    html: layout(
      'Restablece tu contraseña',
      [
        `Hola ${name}:`,
        'Escribe este código en la app para elegir una contraseña nueva. Caduca en 30 minutos.',
        'Si no lo pediste, ignora este correo: tu contraseña no cambia.',
      ],
      code,
    ),
  };
}

/** Aviso de seguridad al vincular Google a una cuenta existente (8.2, flujo de Google). */
export function googleLinkedEmail(to: string, fullName: string): MailMessage {
  const name = escapeHtml(greeting(fullName));
  return {
    to,
    subject: 'Se vinculó una cuenta de Google a tu cuenta de rideapp',
    text: `Hola ${greeting(fullName)}:\n\nAcabas de iniciar sesión en rideapp con Google y la vinculamos a tu cuenta. Si no fuiste tú, cambia tu contraseña y escríbenos.`,
    html: layout('Google vinculado a tu cuenta', [
      `Hola ${name}:`,
      'Acabas de iniciar sesión en rideapp con Google y la vinculamos a tu cuenta.',
      'Si no fuiste tú, cambia tu contraseña y escríbenos.',
    ]),
  };
}

export function passwordChangedEmail(to: string, fullName: string): MailMessage {
  const name = escapeHtml(greeting(fullName));
  return {
    to,
    subject: 'Tu contraseña de rideapp cambió',
    text: `Hola ${greeting(fullName)}:\n\nTu contraseña se cambió y cerramos tus sesiones abiertas. Si no fuiste tú, escríbenos de inmediato.`,
    html: layout('Tu contraseña cambió', [
      `Hola ${name}:`,
      'Tu contraseña se cambió y cerramos todas tus sesiones abiertas.',
      'Si no fuiste tú, escríbenos de inmediato.',
    ]),
  };
}

export interface ReceiptData {
  tripId: string;
  amountCents: number;
  currency: string;
  paymentMethod: 'CASH' | 'FAKE_CARD';
  originAddress: string | null;
  destinationAddress: string | null;
  distanceMeters: number;
  completedAt: Date;
  driverName: string | null;
}

const formatAmount = (cents: number, currency: string) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(d);

/** Recibo del viaje (8.13, paso 4; 9.5): lo recibe solo el pasajero, dueño de esos datos. */
export function receiptEmail(to: string, fullName: string, r: ReceiptData): MailMessage {
  const total = formatAmount(r.amountCents, r.currency);
  const method = r.paymentMethod === 'CASH' ? 'Efectivo' : 'Tarjeta (demo)';
  const km = (r.distanceMeters / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 });
  const rows: [string, string][] = [
    ['Fecha', formatDate(r.completedAt)],
    ['Desde', r.originAddress ?? 'Punto en el mapa'],
    ['Hasta', r.destinationAddress ?? 'Punto en el mapa'],
    ['Distancia', `${km} km`],
    ['Conductor', r.driverName ?? '—'],
    ['Pago', method],
    ['Viaje', r.tripId.slice(-8).toUpperCase()],
  ];
  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5b6875">${k}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return {
    to,
    subject: `Tu recibo de rideapp: ${total}`,
    text:
      `Hola ${greeting(fullName)}:\n\nGracias por viajar con rideapp. Total: ${total}\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: layout(
      'Tu recibo',
      [
        `Hola ${escapeHtml(greeting(fullName))}:`,
        'Gracias por viajar con rideapp.',
        `<span style="font-size:28px;font-weight:700">${escapeHtml(total)}</span>`,
        `<table style="border-collapse:collapse;font-size:14px">${table}</table>`,
      ],
      undefined,
      '¿Algo no cuadra con este viaje? Responde a este correo y lo revisamos.',
    ),
  };
}
