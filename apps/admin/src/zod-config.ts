import { z } from 'zod';

// La CSP prohíbe eval: Zod no debe intentar compilar validadores con new Function.
// Va en su propio módulo, importado el primero en main.tsx, porque Zod lo comprueba al
// construir los esquemas, y eso ocurre al importar @rideapp/contracts.
z.config({ jitless: true });
