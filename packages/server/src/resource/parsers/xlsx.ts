import * as XLSX from 'xlsx';

export async function parseXlsx(filePath: string): Promise<string> {
  const workbook = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      parts.push(`## Sheet: ${sheetName}\n\n${csv}`);
    }
  }
  return parts.join('\n\n').trim();
}
