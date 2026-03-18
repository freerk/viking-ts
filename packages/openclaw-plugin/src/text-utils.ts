const MEMORY_TRIGGERS = [
  /\bremember\b/i,
  /\bpreference[s]?\b/i,
  /\bimportant\b/i,
  /\bdecided\b/i,
  /\bmy name is\b/i,
  /\bi (?:am|work|live|prefer|like|hate|love|use|need)\b/i,
  /\b[\w.-]+@[\w.-]+\.\w{2,}\b/,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
  /\balways\b/i,
  /\bnever\b/i,
  /\bdon't forget\b/i,
  /\bkeep in mind\b/i,
  /\bfor future reference\b/i,
];

export function sanitizeTextForCapture(text: string): string {
  let cleaned = text;

  cleaned = cleaned.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>/g, '');
  cleaned = cleaned.replace(/<conversation-metadata>[\s\S]*?<\/conversation-metadata>/g, '');
  cleaned = cleaned.replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*\s*/gm, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

export function shouldCapture(
  text: string,
  mode: 'semantic' | 'keyword',
): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 10) return false;
  if (trimmed.length > 50000) return false;
  if (trimmed.startsWith('/')) return false;
  if (/^[!?.,:;]+$/.test(trimmed)) return false;

  if (mode === 'semantic') {
    return true;
  }

  return MEMORY_TRIGGERS.some((trigger) => trigger.test(trimmed));
}
