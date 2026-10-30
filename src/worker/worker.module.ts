import {
  Inject,
  Injectable,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ClassificationModule } from '../classification/classification.module';
import { CLASSIFIER, Classifier } from '../classification/classifier';
import { Env } from '../config/env';
import { CoreModule } from '../core.module';
import { ClassificationWorker } from './classification-worker';

// Starts the worker loop with the app and stops it (finishing the current
// round) on shutdown.
@Injectable()
class WorkerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly worker: ClassificationWorker;

  constructor(
    dataSource: DataSource,
    @Inject(CLASSIFIER) classifier: Classifier,
    config: ConfigService<Env, true>,
  ) {
    const get = <K extends keyof Env>(key: K) =>
      config.get(key, { infer: true });
    this.worker = new ClassificationWorker(dataSource, classifier, {
      batchSize: get('WORKER_BATCH_SIZE'),
      pollIntervalMs: get('WORKER_POLL_INTERVAL_MS'),
      maxAttempts: get('WORKER_MAX_ATTEMPTS'),
      retryBaseMs: get('WORKER_RETRY_BASE_MS'),
      retryMaxMs: get('WORKER_RETRY_MAX_MS'),
      staleLockMs: get('WORKER_STALE_LOCK_MS'),
    });
  }

  onApplicationBootstrap(): void {
    this.worker.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.stop();
  }
}

@Module({
  imports: [CoreModule, ClassificationModule],
  providers: [WorkerRunner],
})
export class WorkerModule {}
