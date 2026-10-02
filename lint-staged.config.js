// pre-commit (7.8): formato y lint solo de los archivos cambiados.
// ESLint 10 busca la configuración junto a cada archivo, así que usa la de cada paquete.
export default {
  '*.{ts,tsx,js,mjs,cjs}': ['eslint --fix --no-warn-ignored', 'prettier --write'],
  '*.{json,md,yml,yaml,css,html}': ['prettier --write'],
};
