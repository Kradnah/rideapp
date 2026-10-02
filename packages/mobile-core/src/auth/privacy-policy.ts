import { CURRENT_POLICY_VERSION } from '@rideapp/contracts';

/**
 * BORRADOR de la Política de Tratamiento de la Información (Ley 1581 de 2012, sección 15).
 * Los datos entre corchetes los debe completar el responsable, y el texto final lo debe
 * revisar un abogado antes de operar con usuarios reales.
 */
export const PRIVACY_POLICY = {
  version: CURRENT_POLICY_VERSION,
  draft: true,
  sections: [
    {
      title: 'Responsable del tratamiento',
      body: '[Razón social o nombre del responsable], [NIT o documento], con domicilio en Girardot (Cundinamarca). Contacto para temas de datos personales: [correo de contacto].',
    },
    {
      title: 'Qué datos tratamos',
      body: 'Nombre, email y, si lo das, tu teléfono; la ubicación del dispositivo mientras usas la app para pedir o prestar un servicio; el historial de viajes y pagos; y, si eres conductor, los datos y documentos necesarios para verificarte. No pedimos datos que no necesitamos.',
    },
    {
      title: 'Para qué los usamos',
      body: 'Para crear y proteger tu cuenta, conectar pasajeros con conductores, mostrar el recorrido del viaje, calcular tarifas, emitir recibos, atender soporte y disputas, cumplir obligaciones legales y mejorar la seguridad del servicio. La ubicación se usa solo para prestar el servicio, nunca para publicidad.',
    },
    {
      title: 'Ubicación',
      body: 'La app del pasajero usa tu ubicación solo mientras está abierta. La del conductor la usa en segundo plano únicamente mientras está "en línea", y deja de hacerlo al desconectarse. La traza de cada viaje se conserva 90 días para soporte y seguridad y después se borra.',
    },
    {
      title: 'Con quién los compartimos',
      body: 'Con el conductor o pasajero de tu viaje (nombre, calificación y, durante el viaje, la información necesaria para encontrarse). Con proveedores que nos prestan servicios técnicos: alojamiento del servidor, Google (inicio de sesión y mapas) y servicios de notificaciones. Algunos están fuera de Colombia; al aceptar autorizas esa transferencia. Nunca vendemos tus datos.',
    },
    {
      title: 'Tus derechos',
      body: 'Puedes conocer, actualizar, rectificar y suprimir tus datos, revocar esta autorización, pedir prueba de ella y presentar quejas ante la Superintendencia de Industria y Comercio. Desde la app puedes editar tu perfil y, próximamente, descargar tus datos o eliminar tu cuenta.',
    },
    {
      title: 'Consultas y reclamos',
      body: 'Escríbenos a [correo de contacto]. Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles.',
    },
    {
      title: 'Conservación y seguridad',
      body: 'Guardamos los datos mientras tu cuenta esté activa y el tiempo que exijan las normas (por ejemplo, las contables). Al eliminar tu cuenta, anonimizamos tus datos personales. Usamos cifrado en tránsito, contraseñas protegidas con algoritmos modernos y acceso interno restringido y auditado.',
    },
    {
      title: 'Vigencia',
      body: `Esta política rige desde el ${CURRENT_POLICY_VERSION}. Si cambia de forma sustancial, te pediremos aceptarla de nuevo.`,
    },
  ],
} as const;
