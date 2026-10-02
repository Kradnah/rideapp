import base from '@rideapp/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts'] },
  ...base,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
];
