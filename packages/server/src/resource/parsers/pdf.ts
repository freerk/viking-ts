import { PDFParse } from 'pdf-parse';
import { readFileSync } from 'fs';

export async function parsePdf(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text.trim();
}
