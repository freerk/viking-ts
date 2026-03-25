import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  task_id: string;
  task_type: string;
  resource_id?: string;
  status: TaskStatus;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface TaskFilters {
  taskType?: string;
  status?: string;
  resourceId?: string;
  limit?: number;
}

@Injectable()
export class TaskTrackerService {
  private readonly tasks = new Map<string, Task>();

  create(taskType: string, resourceId?: string): Task {
    const task: Task = {
      task_id: randomUUID(),
      task_type: taskType,
      resource_id: resourceId,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    this.tasks.set(task.task_id, task);
    return task;
  }

  start(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'running';
    task.started_at = new Date().toISOString();
  }

  complete(taskId: string, result: Record<string, unknown>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'completed';
    task.completed_at = new Date().toISOString();
    task.result = result;
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.completed_at = new Date().toISOString();
    task.error = error;
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  hasRunning(taskType: string, resourceId: string): boolean {
    for (const task of this.tasks.values()) {
      if (
        task.task_type === taskType &&
        task.resource_id === resourceId &&
        (task.status === 'pending' || task.status === 'running')
      ) {
        return true;
      }
    }
    return false;
  }

  createIfNoRunning(taskType: string, resourceId: string): Task | null {
    if (this.hasRunning(taskType, resourceId)) return null;
    return this.create(taskType, resourceId);
  }

  list(filters?: TaskFilters): Task[] {
    let results = Array.from(this.tasks.values());

    if (filters?.taskType) {
      results = results.filter((t) => t.task_type === filters.taskType);
    }
    if (filters?.status) {
      results = results.filter((t) => t.status === filters.status);
    }
    if (filters?.resourceId) {
      results = results.filter((t) => t.resource_id === filters.resourceId);
    }

    results.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const limit = filters?.limit ?? 100;
    return results.slice(0, limit);
  }
}
