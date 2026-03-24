/**
 * Integration test for LLM memory extraction pipeline.
 *
 * Requires a real LLM API key configured via environment variables.
 * Skipped in CI (no API key). Run locally with:
 *   VLM_PROVIDER=openai VLM_API_KEY=sk-... npx jest test/integration/llm-extraction.spec.ts
 */
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { LlmService } from '../../src/llm/llm.service';
import { LlmModule } from '../../src/llm/llm.module';

const hasApiKey = Boolean(process.env['VLM_API_KEY']);

const describeIf = hasApiKey ? describe : describe.skip;

describeIf('LLM Memory Extraction (integration)', () => {
  let llmService: LlmService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              vlm: {
                provider: process.env['VLM_PROVIDER'] ?? 'openai',
                model: process.env['VLM_MODEL'] ?? 'gpt-4o-mini',
                apiKey: process.env['VLM_API_KEY'] ?? '',
                apiBase: process.env['VLM_API_BASE'] ?? '',
              },
            }),
          ],
        }),
        LlmModule,
      ],
    }).compile();

    llmService = module.get<LlmService>(LlmService);
    llmService.onModuleInit();
  });

  it('should extract preferences memory with L0/L1/L2 from session', async () => {
    const messages = [
      { role: 'user', content: 'I prefer dark mode in all tools and TypeScript strict mode always' },
      { role: 'assistant', content: 'Got it, I will remember your preferences for dark mode and TypeScript strict mode.' },
    ];

    const candidates = await llmService.extractMemoriesFromSession(
      'test-user',
      messages,
      'en',
    );

    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const prefMemory = candidates.find((c) => c.category === 'preferences');
    expect(prefMemory).toBeDefined();

    if (prefMemory) {
      // L0 abstract: should match "[Topic]: [Description]" format
      expect(prefMemory.abstract).toBeTruthy();
      expect(prefMemory.abstract).toContain(':');

      // L1 overview: should contain structured Markdown heading
      expect(prefMemory.overview).toBeTruthy();
      expect(prefMemory.overview).toMatch(/## (Preference Domain|Specific Preference)/);

      // L2 content: full narrative
      expect(prefMemory.content).toBeTruthy();
      expect(prefMemory.content.length).toBeGreaterThan(10);
    }
  }, 30_000);
});
