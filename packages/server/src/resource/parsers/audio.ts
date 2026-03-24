import { readFileSync } from 'fs';
import { basename } from 'path';

export interface TranscriptionConfig {
  provider: string;
  apiKey: string;
  apiBase: string;
  model: string;
}

export async function parseAudio(
  filePath: string,
  transcriptionConfig: TranscriptionConfig,
): Promise<string> {
  const { apiKey, apiBase, model } = transcriptionConfig;
  if (!apiKey) return '[Audio transcription not configured]';

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([readFileSync(filePath)]),
    basename(filePath),
  );
  formData.append('model', model || 'whisper-1');

  const response = await fetch(`${apiBase}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.status}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text;
}
