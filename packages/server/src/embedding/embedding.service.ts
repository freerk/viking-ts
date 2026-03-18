import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private client!: OpenAI;
  private model!: string;
  private dimension!: number;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('embedding.apiKey', '');
    const apiBase = this.config.get<string>('embedding.apiBase', 'https://api.openai.com/v1');
    this.model = this.config.get<string>('embedding.model', 'text-embedding-3-small');
    this.dimension = this.config.get<number>('embedding.dimension', 1536);

    this.client = new OpenAI({
      apiKey: apiKey || 'dummy-key',
      baseURL: apiBase,
    });

    this.logger.log(`Embedding service initialized: model=${this.model}, dim=${this.dimension}`);
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return new Array(this.dimension).fill(0) as number[];
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: trimmed,
      dimensions: this.dimension,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('No embedding returned from provider');
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const nonEmpty = texts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (nonEmpty.length === 0) {
      return texts.map(() => new Array(this.dimension).fill(0) as number[]);
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: nonEmpty,
      dimensions: this.dimension,
    });

    const embeddings = response.data.map((d) => d.embedding);
    let embIdx = 0;
    return texts.map((t) => {
      if (t.trim().length === 0) {
        return new Array(this.dimension).fill(0) as number[];
      }
      return embeddings[embIdx++] ?? (new Array(this.dimension).fill(0) as number[]);
    });
  }

  getDimension(): number {
    return this.dimension;
  }
}
