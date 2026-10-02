import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type Job, type JobsOptions, Queue, Worker } from 'bullmq';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

/** Tareas periódicas (8.15): latido, búsquedas abandonadas, cotizaciones caducadas. */
export const MAINTENANCE_QUEUE = 'maintenance';

export type JobHandler = (job: Job) => Promise<unknown>;

interface QueueSetup {
  handlers: Map<string, JobHandler>;
  concurrency: number;
  schedules: { id: string; everyMs: number }[];
}

/**
 * Colas de BullMQ sobre el mismo Redis (sección 1, "Colas / trabajos"): búsqueda de conductor,
 * caducidad de ofertas y tareas periódicas. Los workers corren dentro del proceso del API; con
 * varias réplicas, cada job lo procesa una sola.
 *
 * Los módulos registran sus handlers al iniciarse (`handle`, `every`) y los workers arrancan
 * cuando la app ya está lista.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly setups = new Map<string, QueueSetup>();
  private readonly workers: Worker[] = [];
  private closed = false;

  constructor(@InjectEnv() private readonly env: Env) {}

  private connection(role: string) {
    return {
      url: this.env.REDIS_URL,
      connectionName: `rideapp-api:bullmq-${role}`,
      // Obligatorio para los workers (conexión bloqueante): BullMQ reintenta por su cuenta.
      maxRetriesPerRequest: null,
    };
  }

  private setup(queue: string): QueueSetup {
    let setup = this.setups.get(queue);
    if (!setup) {
      setup = { handlers: new Map(), concurrency: 1, schedules: [] };
      this.setups.set(queue, setup);
    }
    return setup;
  }

  queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection(`${name}-queue`),
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000 },
      });
      queue.on('error', (err) => this.logger.warn(`Cola ${name}: ${err.message}`));
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Registra el handler de un tipo de job. Llamar en `onModuleInit`. */
  handle(queue: string, name: string, handler: JobHandler, concurrency = 1): void {
    const setup = this.setup(queue);
    setup.handlers.set(name, handler);
    setup.concurrency = Math.max(setup.concurrency, concurrency);
  }

  /** Job repetitivo (job scheduler de BullMQ): uno solo aunque haya varias réplicas. */
  every(queue: string, name: string, everyMs: number, handler: JobHandler): void {
    this.handle(queue, name, handler);
    this.setup(queue).schedules.push({ id: name, everyMs });
  }

  add(queue: string, name: string, data: object, opts?: JobsOptions): Promise<Job> {
    return this.queue(queue).add(name, data, opts);
  }

  onApplicationBootstrap(): void {
    for (const [queue, setup] of this.setups) {
      const worker = new Worker(
        queue,
        async (job) => {
          const handler = setup.handlers.get(job.name);
          if (!handler) throw new Error(`Job desconocido en ${queue}: ${job.name}`);
          return handler(job);
        },
        { connection: this.connection(`${queue}-worker`), concurrency: setup.concurrency },
      );
      worker.on('error', (err) => this.logger.warn(`Worker ${queue}: ${err.message}`));
      worker.on('failed', (job, err) =>
        this.logger.error({ err, queue, job: job?.name, jobId: job?.id }, 'Falló un job'),
      );
      this.workers.push(worker);

      for (const { id, everyMs } of setup.schedules) {
        // Sin await: si Redis no está, la app arranca igual y BullMQ reintenta.
        this.queue(queue)
          .upsertJobScheduler(id, { every: everyMs }, { name: id })
          .catch((err: unknown) =>
            this.logger.warn({ err, queue, id }, 'No se pudo programar la tarea periódica'),
          );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
