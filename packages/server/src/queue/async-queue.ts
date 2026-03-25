import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface QueueJob<T> {
  readonly id: string;
  readonly data: T;
  readonly createdAt: string;
  attempts: number;
}

export interface QueueStats {
  queued: number;
  active: number;
  processed: number;
  errors: number;
}

export class AsyncQueue<T> {
  private readonly logger: Logger;
  private readonly jobs: QueueJob<T>[] = [];
  private handler: ((job: QueueJob<T>) => Promise<void>) | null = null;
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private processedCount = 0;
  private errorCount = 0;
  private running = false;
  private readonly activeIds = new Set<string>();

  constructor(name: string, maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
    this.logger = new Logger(`AsyncQueue:${name}`);
  }

  setHandler(fn: (job: QueueJob<T>) => Promise<void>): void {
    this.handler = fn;
  }

  enqueue(data: T, id?: string): QueueJob<T> {
    const jobId = id ?? randomUUID();

    if (this.activeIds.has(jobId)) {
      this.logger.debug(`Job ${jobId} already active, skipping`);
      return { id: jobId, data, createdAt: new Date().toISOString(), attempts: 0 };
    }

    const duplicateIndex = this.jobs.findIndex((j) => j.id === jobId);
    if (duplicateIndex >= 0) {
      const existing = this.jobs[duplicateIndex];
      if (existing) return existing;
    }

    const job: QueueJob<T> = {
      id: jobId,
      data,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    this.jobs.push(job);
    this.processNext();
    return job;
  }

  getStats(): QueueStats {
    return {
      queued: this.jobs.length,
      active: this.activeCount,
      processed: this.processedCount,
      errors: this.errorCount,
    };
  }

  start(): void {
    this.running = true;
    this.processNext();
  }

  stop(): void {
    this.running = false;
  }

  private processNext(): void {
    if (!this.running || !this.handler) return;
    if (this.activeCount >= this.maxConcurrent) return;
    if (this.jobs.length === 0) return;

    const job = this.jobs.shift();
    if (!job) return;

    this.activeCount++;
    this.activeIds.add(job.id);

    void this.executeJob(job);
  }

  private async executeJob(job: QueueJob<T>): Promise<void> {
    try {
      job.attempts++;
      await this.handler!(job);
      this.processedCount++;
    } catch (err) {
      this.errorCount++;
      this.logger.error(`Job ${job.id} failed (attempt ${job.attempts}): ${String(err)}`);
    } finally {
      this.activeCount--;
      this.activeIds.delete(job.id);
      this.processNext();
    }
  }
}
