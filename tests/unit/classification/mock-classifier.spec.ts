import {
  ClassificationFailedError,
  MockClassifier,
  MockClassifierOptions,
} from '../../../src/classification/mock-classifier';

const input = { title: 'Football tournament', description: 'Kids' };

function make(
  over: Partial<MockClassifierOptions> = {},
  randoms: number[] = [0.5],
) {
  // Records the requested delay (in its calls) without waiting.
  const sleep = jest.fn((): Promise<void> => Promise.resolve());
  let i = 0;
  const random = jest.fn(() => randoms[i++ % randoms.length]);
  const classifier = new MockClassifier(
    {
      minDelayMs: 100,
      maxDelayMs: 1100,
      failureRate: 0,
      reviewThreshold: 0.7,
      ...over,
    },
    random,
    sleep,
  );
  return { classifier, sleep, random };
}

describe('MockClassifier', () => {
  it('returns the keyword-rules result', async () => {
    const { classifier } = make();
    await expect(classifier.classify(input)).resolves.toEqual({
      category: 'sports',
      confidence: 1,
      needsReview: false,
    });
  });

  it('uses the review threshold it was given', async () => {
    const { classifier } = make({ reviewThreshold: 1 });
    const r = await classifier.classify({
      title: 'Saturday event',
      description: 'Near the museum',
    });
    expect(r.needsReview).toBe(true);
  });

  it.each([
    [0, 100],
    [0.5, 600],
    [0.999, 1099],
  ])('random %s → waits %i ms (between min and max)', async (rnd, ms) => {
    const { classifier, sleep } = make({}, [rnd, 0.99]);
    await classifier.classify(input);
    expect(sleep).toHaveBeenCalledWith(ms);
  });

  it('min = max → always that delay', async () => {
    const { classifier, sleep } = make({ minDelayMs: 0, maxDelayMs: 0 });
    await classifier.classify(input);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it('failure rate 0 → never fails', async () => {
    const { classifier } = make({ failureRate: 0 }, [0, 0, 0.0001]);
    for (let n = 0; n < 20; n++) {
      await expect(classifier.classify(input)).resolves.toBeDefined();
    }
  });

  it('failure rate 1 → always fails, with ClassificationFailedError', async () => {
    const { classifier } = make({ failureRate: 1 }, [0.5, 0.9999]);
    await expect(classifier.classify(input)).rejects.toThrow(
      ClassificationFailedError,
    );
  });

  it('fails when the roll is below the rate, succeeds otherwise', async () => {
    const fails = make({ failureRate: 0.3 }, [0.5, 0.29]);
    await expect(fails.classifier.classify(input)).rejects.toThrow(
      ClassificationFailedError,
    );
    const ok = make({ failureRate: 0.3 }, [0.5, 0.3]);
    await expect(ok.classifier.classify(input)).resolves.toBeDefined();
  });

  it('a failure still takes the delay (slow failures, like a real service)', async () => {
    const { classifier, sleep } = make({ failureRate: 1 }, [0.5, 0.1]);
    await expect(classifier.classify(input)).rejects.toThrow();
    expect(sleep).toHaveBeenCalledWith(600);
  });

  it('failure message says it was simulated', async () => {
    const { classifier } = make({ failureRate: 1 }, [0.5, 0.1]);
    await expect(classifier.classify(input)).rejects.toThrow(/simulated/i);
  });
});
