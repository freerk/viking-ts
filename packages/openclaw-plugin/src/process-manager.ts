import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';

export class ProcessManager {
  private process: ChildProcess | undefined;
  private stderrBuffer: string[] = [];
  private readonly maxStderrLines = 200;

  async startServer(port: number, storagePath?: string): Promise<void> {
    const serverMain = resolve(__dirname, '../../server/dist/main.js');

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PORT: String(port),
      HOST: '127.0.0.1',
    };

    if (storagePath) {
      env['STORAGE_PATH'] = storagePath;
    }

    this.process = spawn('node', [serverMain], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        this.stderrBuffer.push(line);
        if (this.stderrBuffer.length > this.maxStderrLines) {
          this.stderrBuffer.shift();
        }
      }
    });

    this.process.on('exit', (code) => {
      if (code !== null && code !== 0) {
        const lastLines = this.stderrBuffer.slice(-10).join('\n');
        process.stderr.write(
          `[viking-ts] Server exited with code ${code}\n${lastLines}\n`,
        );
      }
      this.process = undefined;
    });

    await this.waitForHealth(port, 15000);
  }

  stopServer(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
  }

  getStderrTail(lines: number = 20): string[] {
    return this.stderrBuffer.slice(-lines);
  }

  private async waitForHealth(
    port: number,
    timeoutMs: number,
  ): Promise<void> {
    const start = Date.now();
    const interval = 250;

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) return;
      } catch {
        /* server not ready yet */
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(
      `viking-ts server did not become healthy within ${timeoutMs}ms`,
    );
  }
}
