import { useColorScheme } from 'react-native';
import { colors, type Palette } from './theme';

/** Paleta del tema claro u oscuro según el sistema. */
export function usePalette(): Palette {
  return colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
