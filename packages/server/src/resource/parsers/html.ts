import { parse } from 'node-html-parser';
import { readFileSync } from 'fs';

export async function parseHtml(filePath: string): Promise<string> {
  const html = readFileSync(filePath, 'utf-8');
  return stripHtmlTags(html);
}

export function stripHtmlTags(html: string): string {
  const root = parse(html);
  root.querySelectorAll('script, style').forEach((el) => el.remove());
  return root.textContent.replace(/\s+/g, ' ').trim();
}
