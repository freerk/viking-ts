import { OfficeParser } from 'officeparser';

export async function parsePptx(filePath: string): Promise<string> {
  // OfficeParser.parseOffice resolves to a string directly
  const text = await OfficeParser.parseOffice(filePath);
  return (typeof text === 'string' ? text : String(text)).trim();
}
