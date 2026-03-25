declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  function extractRawText(options: { path: string }): Promise<ExtractResult>;
  function extractRawText(options: { buffer: Buffer }): Promise<ExtractResult>;

  export default { extractRawText };
}
