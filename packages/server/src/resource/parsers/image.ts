import { readFileSync } from 'fs';
import { extname } from 'path';
import { LlmService } from '../../llm/llm.service';

export async function parseImage(
  filePath: string,
  llmService: LlmService,
): Promise<string> {
  const imageBuffer = readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');
  const ext = extname(filePath).slice(1).toLowerCase();
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

  const description = await llmService.describeImage(
    'Describe this image in detail. Extract any text visible. Be comprehensive.',
    base64,
    mimeType,
  );
  return description;
}
