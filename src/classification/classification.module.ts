import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { CLASSIFIER } from './classifier';
import { MockClassifier } from './mock-classifier';

// Provides the classifier (the mock, configured from env) under CLASSIFIER.
@Module({
  providers: [
    {
      provide: CLASSIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new MockClassifier({
          minDelayMs: config.get('CLASSIFIER_MIN_DELAY_MS', { infer: true }),
          maxDelayMs: config.get('CLASSIFIER_MAX_DELAY_MS', { infer: true }),
          failureRate: config.get('CLASSIFIER_FAILURE_RATE', { infer: true }),
          reviewThreshold: config.get('REVIEW_THRESHOLD', { infer: true }),
        }),
    },
  ],
  exports: [CLASSIFIER],
})
export class ClassificationModule {}
