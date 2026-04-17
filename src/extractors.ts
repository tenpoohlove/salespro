import path from 'path';
import iconv from 'iconv-lite';

const CHAR_LIMIT = 40000; // 約10,000〜20,000トークン相当

function truncateIfNeeded(text: string, filename: string): string {
  if (text.length <= CHAR_LIMIT) return text;
  const truncated = text.slice(0, CHAR_LIMIT);
  const ratio = Math.round(CHAR_LIMIT / text.length * 100);
  return truncated + `\n\n---\n⚠️ [${filename}] ファイルが大きすぎるため冒頭 ${ratio}%（${CHAR_LIMIT.toLocaleString()}文字）のみ分析しています。`;
}

export interface ExtractedContent {
  type: 'text' | 'image';
  filename: string;
  text?: string;
  imageBase64?: string;
  imageMime?: string;
}

export async function extractContent(
  buffer: Buffer,
  originalName: string
): Promise<ExtractedContent[]> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    return extractPDF(buffer, originalName);
  } else if (ext === '.docx' || ext === '.doc') {
    return extractDOCX(buffer, originalName);
  } else if (ext === '.pptx' || ext === '.ppt') {
    return extractPPTX(buffer, originalName);
  } else if (['.txt', '.md', '.srt', '.vtt'].includes(ext)) {
    return extractText(buffer, originalName);
  } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    return extractImage(buffer, originalName, ext);
  } else {
    return [{ type: 'text', filename: originalName, text: `[${originalName}: 対応していないファイル形式です]` }];
  }
}

async function extractPDF(buffer: Buffer, filename: string): Promise<ExtractedContent[]> {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return [{ type: 'text', filename, text: truncateIfNeeded(data.text, filename) }];
  } catch (e) {
    console.error(`[extractPDF] ${filename}:`, e);
    return [{ type: 'text', filename, text: `[PDFの解析に失敗しました。ファイルが破損しているか、パスワード保護されている可能性があります]` }];
  }
}

async function extractDOCX(buffer: Buffer, filename: string): Promise<ExtractedContent[]> {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return [{ type: 'text', filename, text: truncateIfNeeded(result.value, filename) }];
  } catch (e) {
    console.error(`[extractDOCX] ${filename}:`, e);
    return [{ type: 'text', filename, text: `[DOCXの解析に失敗しました。ファイルが破損している可能性があります]` }];
  }
}

async function extractPPTX(buffer: Buffer, filename: string): Promise<ExtractedContent[]> {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const slideTexts: string[] = [];

    const slideFiles = Object.keys(zip.files)
      .filter((name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a: string, b: string) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
        return numA - numB;
      });

    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = slideFiles[i];
      const content = await zip.files[slideFile].async('string');
      const texts = extractXMLText(content);
      if (texts.trim()) {
        slideTexts.push(`【スライド ${i + 1}】\n${texts}`);
      }
    }

    return [{ type: 'text', filename, text: truncateIfNeeded(slideTexts.join('\n\n'), filename) }];
  } catch (e) {
    console.error(`[extractPPTX] ${filename}:`, e);
    return [{ type: 'text', filename, text: `[PPTXの解析に失敗しました。ファイルが破損している可能性があります]` }];
  }
}

function extractXMLText(xml: string): string {
  const noTags = xml.replace(/<[^>]+>/g, ' ');
  return noTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractText(buffer: Buffer, filename: string): Promise<ExtractedContent[]> {
  const text = decodeText(buffer);
  return [{ type: 'text', filename, text: truncateIfNeeded(text, filename) }];
}

function decodeText(buffer: Buffer): string {
  // UTF-8 BOM チェック
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf-8');
  }
  // UTF-8 として読んで文字化けがなければそのまま使う
  const utf8 = buffer.toString('utf-8');
  if (!utf8.includes('\ufffd')) return utf8;
  // 文字化けがあれば Shift-JIS として再デコード
  return iconv.decode(buffer, 'Shift_JIS');
}

async function extractImage(buffer: Buffer, filename: string, ext: string): Promise<ExtractedContent[]> {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return [{
    type: 'image',
    filename,
    imageBase64: buffer.toString('base64'),
    imageMime: mimeMap[ext] || 'image/jpeg',
  }];
}
