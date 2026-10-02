/** Tokens de diseño compartidos por las apps del pasajero y del conductor. */
export const colors = {
  light: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    text: '#16202a',
    textMuted: '#5b6875',
    border: '#dde3e9',
    accent: '#0f766e',
    onAccent: '#ffffff',
    ok: '#15803d',
    down: '#b91c1c',
    pending: '#a16207',
  },
  dark: {
    bg: '#0e1418',
    surface: '#161e24',
    text: '#e6edf2',
    textMuted: '#93a2ae',
    border: '#2a363f',
    accent: '#2dd4bf',
    onAccent: '#04201d',
    ok: '#4ade80',
    down: '#f87171',
    pending: '#facc15',
  },
} as const;

export type Palette = (typeof colors)['light' | 'dark'];

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { md: 10, lg: 16, pill: 999 } as const;
