import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// Background worker process: no HTTP server, just the classification loop.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGTERM / SIGINT (docker stop, Ctrl+C) → finish the current round, exit.
  app.enableShutdownHooks();
  new Logger('Worker').log('Classification worker started');
}

void bootstrap();
