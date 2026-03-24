import { parseHtml, stripHtmlTags } from './html';
import { parsePdf } from './pdf';
import { parseDocx } from './docx';
import { parseXlsx } from './xlsx';
import { parsePptx } from './pptx';
import { parseImage } from './image';
import { parseAudio, TranscriptionConfig } from './audio';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: 'Extracted PDF text content', pages: [], total: 1 }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readFileSync: jest.fn().mockImplementation((path: string, encoding?: string) => {
      if (typeof path === 'string' && path.startsWith('/fake/')) {
        return encoding ? 'fake content' : Buffer.from('fake content');
      }
      return actual.readFileSync(path, encoding);
    }),
  };
});

jest.mock('mammoth', () => ({
  default: {
    extractRawText: jest.fn().mockResolvedValue({
      value: 'Extracted DOCX text content',
      messages: [],
    }),
  },
  __esModule: true,
}));

jest.mock('xlsx', () => ({
  readFile: jest.fn().mockReturnValue({
    SheetNames: ['Sheet1', 'Sheet2'],
    Sheets: {
      Sheet1: {},
      Sheet2: {},
    },
  }),
  utils: {
    sheet_to_csv: jest.fn()
      .mockReturnValueOnce('Name,Value\nAlice,100')
      .mockReturnValueOnce('Header\nRow1'),
  },
}));

jest.mock('officeparser', () => ({
  OfficeParser: {
    parseOffice: jest.fn().mockResolvedValue({
      toText: jest.fn().mockReturnValue('Slide 1: Title\nSlide 2: Content'),
    }),
  },
}));

describe('parsePdf', () => {
  it('should extract text from PDF buffer', async () => {
    const result = await parsePdf('/fake/file.pdf');
    expect(result).toBe('Extracted PDF text content');
  });
});

describe('parseDocx', () => {
  it('should extract raw text from DOCX', async () => {
    const result = await parseDocx('/fake/file.docx');
    expect(result).toBe('Extracted DOCX text content');
  });
});

describe('parseXlsx', () => {
  it('should return CSV-formatted text per sheet', async () => {
    const result = await parseXlsx('/fake/file.xlsx');
    expect(result).toContain('## Sheet: Sheet1');
    expect(result).toContain('Name,Value');
    expect(result).toContain('## Sheet: Sheet2');
    expect(result).toContain('Header');
  });
});

describe('parsePptx', () => {
  it('should extract text from PPTX via officeparser', async () => {
    const result = await parsePptx('/fake/file.pptx');
    expect(result).toBe('Slide 1: Title\nSlide 2: Content');
  });
});

describe('parseHtml', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'parser-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should strip HTML tags and return text content', async () => {
    const htmlFile = join(tmpDir, 'test.html');
    writeFileSync(htmlFile, '<html><body><h1>Title</h1><p>Paragraph text</p></body></html>');

    const result = await parseHtml(htmlFile);
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph text');
  });

  it('should remove script and style tags', async () => {
    const htmlFile = join(tmpDir, 'scripted.html');
    writeFileSync(
      htmlFile,
      '<html><head><style>body{color:red}</style></head><body><script>alert("x")</script><p>Clean</p></body></html>',
    );

    const result = await parseHtml(htmlFile);
    expect(result).toBe('Clean');
  });
});

describe('stripHtmlTags', () => {
  it('should strip tags from HTML string', () => {
    const result = stripHtmlTags('<div><b>Bold</b> text</div>');
    expect(result).toBe('Bold text');
  });

  it('should collapse whitespace', () => {
    const result = stripHtmlTags('<p>First</p>   \n\n   <p>Second</p>');
    expect(result).toBe('First Second');
  });
});

describe('parseImage', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'image-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should call LlmService.describeImage and return result', async () => {
    const imgFile = join(tmpDir, 'test.png');
    writeFileSync(imgFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const mockLlmService = {
      describeImage: jest.fn().mockResolvedValue('A test image with colored shapes'),
    };

    const result = await parseImage(imgFile, mockLlmService as never);
    expect(result).toBe('A test image with colored shapes');
    expect(mockLlmService.describeImage).toHaveBeenCalledWith(
      expect.stringContaining('Describe this image'),
      expect.any(String),
      'image/png',
    );
  });

  it('should use image/jpeg for .jpg files', async () => {
    const imgFile = join(tmpDir, 'test.jpg');
    writeFileSync(imgFile, Buffer.from([0xff, 0xd8, 0xff]));

    const mockLlmService = {
      describeImage: jest.fn().mockResolvedValue('A photo'),
    };

    await parseImage(imgFile, mockLlmService as never);
    expect(mockLlmService.describeImage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'image/jpeg',
    );
  });
});

describe('parseAudio', () => {
  it('should return not-configured message when apiKey is empty', async () => {
    const config: TranscriptionConfig = {
      provider: 'openai',
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
      model: 'whisper-1',
    };

    const result = await parseAudio('/fake/audio.mp3', config);
    expect(result).toBe('[Audio transcription not configured]');
  });

  it('should call transcription API when configured', async () => {
    const config: TranscriptionConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      apiBase: 'https://api.openai.com/v1',
      model: 'whisper-1',
    };

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ text: 'Transcribed audio content' }),
    });
    global.fetch = mockFetch;

    const tmpDir = mkdtempSync(join(tmpdir(), 'audio-test-'));
    const audioFile = join(tmpDir, 'test.mp3');
    writeFileSync(audioFile, Buffer.from([0x00]));

    const result = await parseAudio(audioFile, config);
    expect(result).toBe('Transcribed audio content');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
      }),
    );

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should throw on API error', async () => {
    const config: TranscriptionConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      apiBase: 'https://api.openai.com/v1',
      model: 'whisper-1',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const tmpDir = mkdtempSync(join(tmpdir(), 'audio-test-'));
    const audioFile = join(tmpDir, 'err.mp3');
    writeFileSync(audioFile, Buffer.from([0x00]));

    await expect(parseAudio(audioFile, config)).rejects.toThrow('Transcription failed: 401');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
