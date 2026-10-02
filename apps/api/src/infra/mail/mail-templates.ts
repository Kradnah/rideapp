import type { MailMessage } from './mailer.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Primer nombre para el saludo; nunca HTML del usuario sin escapar. */
const greeting = (fullName: string) => fullName.trim().split(/\s+/)[0] || 'Hola';

function layout(title: string, paragraphs: string[], code?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('');
  const codeBlock = code
    ? `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">${code}</p>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,sans-serif;color:#16202a">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;color:#0f766e;font-size:22px;font-weight:700">rideapp</p>
<h1 style="margin:0 0 16px;font-size:20px">${title}</h1>${body}${codeBlock}
<p style="margin:24px 0 0;font-size:12px;color:#5b6875">Si no fuiste tú, ignora este correo. Nunca te pediremos este código por teléfono ni por chat.</p>
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
