import { AsyncQueue, QueueStats } from '../../src/queue/async-queue';

describe('AsyncQueue', () => {
  it('should process jobs in FIFO order', async () => {
    const queue = new AsyncQueue<string>('test', 1);
    const processed: string[] = [];

    queue.setHandler(async (job) => {
      processed.push(job.data);
    });
    queue.start();

    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');

    await waitForQueue(queue);

    expect(processed).toEqual(['first', 'second', 'third']);
  });

  it('should deduplicate jobs by id', async () => {
    const queue = new AsyncQueue<string>('test', 1);
    const processed: string[] = [];

    queue.setHandler(async (job) => {
      processed.push(job.data);
    });
    queue.start();

    queue.enqueue('data-a', 'same-id');
    queue.enqueue('data-b', 'same-id');

    await waitForQueue(queue);

    expect(processed).toEqual(['data-a']);
  });

  it('should track stats correctly', async () => {
    const queue = new AsyncQueue<string>('test', 2);
    let errorCount = 0;

    queue.setHandler(async (job) => {
      if (job.data === 'fail') {
        errorCount++;
        throw new Error('Intentional failure');
      }
    });
    queue.start();

    queue.enqueue('ok-1');
    queue.enqueue('fail', 'fail-job');
    queue.enqueue('ok-2');

    await waitForQueue(queue);

    const stats = queue.getStats();
    expect(stats.processed).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.queued).toBe(0);
    expect(stats.active).toBe(0);
    expect(errorCount).toBe(1);
  });

  it('should respect max concurrency', async () => {
    const queue = new AsyncQueue<number>('test', 2);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    queue.setHandler(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise((r) => setTimeout(r, 50));
      currentConcurrent--;
    });
    queue.start();

    for (let i = 0; i < 6; i++) {
      queue.enqueue(i);
    }

    await waitForQueue(queue);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(queue.getStats().processed).toBe(6);
  });

  it('should stop processing when stopped', async () => {
    const queue = new AsyncQueue<string>('test', 1);
    const processed: string[] = [];

    queue.setHandler(async (job) => {
      processed.push(job.data);
      if (job.data === 'stop-trigger') {
        queue.stop();
      }
    });
    queue.start();

    queue.enqueue('stop-trigger');
    queue.enqueue('should-not-process');

    await new Promise((r) => setTimeout(r, 100));

    expect(processed).toEqual(['stop-trigger']);
  });
});

async function waitForQueue(queue: { getStats(): QueueStats }, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stats = queue.getStats();
    if (stats.queued === 0 && stats.active === 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}
