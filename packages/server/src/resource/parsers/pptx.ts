import { OfficeParser } from 'officeparser';

export async function parsePptx(filePath: string): Promise<string> {
  const ast = await OfficeParser.parseOffice(filePath);
  return ast.toText().trim();
}
