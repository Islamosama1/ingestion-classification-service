import { Classifier, ClassifierInput, ClassifierResult } from './classifier';
import { classifyByKeywords } from './keyword-rules';

// The classifier could not produce a result; the worker retries later.
export class ClassificationFailedError extends Error {}

export interface MockClassifierOptions {
  minDelayMs: number;
  maxDelayMs: number;
  // 0..1: chance that a call fails.
  failureRate: number;
  reviewThreshold: number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Stand-in for an external AI service: keyword rules for the answer, plus a
// random delay and random failures. random / sleep are injectable for tests.
export class MockClassifier implements Classifier {
  constructor(
    private readonly options: MockClassifierOptions,
    private readonly random: () => number = Math.random,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    const { minDelayMs, maxDelayMs, failureRate } = this.options;
    await this.sleep(
      minDelayMs + Math.floor(this.random() * (maxDelayMs - minDelayMs)),
    );
    if (this.random() < failureRate) {
      throw new ClassificationFailedError(
        'Classification service unavailable (simulated failure)',
      );
    }
    return classifyByKeywords(input, this.options.reviewThreshold);
  }
}
