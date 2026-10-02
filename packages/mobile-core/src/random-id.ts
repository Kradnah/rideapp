/**
 * UUID v4 para el `sessionToken` de Places y la `Idempotency-Key` (8.6, 8.8). No son secretos
 * (solo deben ser únicos), así que basta Math.random y no hace falta un módulo nativo.
 */
export function randomId(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
