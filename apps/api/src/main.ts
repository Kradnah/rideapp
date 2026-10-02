import 'reflect-metadata';
import { createApp } from './app.factory.js';
import { InvalidEnvError, loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof InvalidEnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await createApp(env);
  await app.listen({ port: env.PORT, host: env.HOST });
}

void bootstrap();
