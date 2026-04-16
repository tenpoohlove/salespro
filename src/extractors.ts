import fs from 'fs';
import path from 'path';

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
    return [{ type: 'text', filename: originalName, text: `[${originalName}: 対応していないファイル形式です。テキスト貼り付けエリアをご利用ください]` }];
  }
}

async function extractPDF(buffer: Buffer, filename: string): Promise<ExtractedContent[]> {
  try {
    // Dynamic import to avoid CommonJS/ESM issues
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return [{ type: 'text', filename, text: data.text }];
  } catch (e) {
    return [{ type: 'text', filename, text: `[PDFの解析に失敗しました: ${(e as Error).message}]` }];
  }
}

async function extractDOCX(buffer: Buffer, filename: string): Promise<ExtractedContent[]> {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return [{ type: 'text', filename, text: result.value }];
  } catch (e) {
    return [{ type: 'text', filename, text: `[DOCXの解析に失敗しました: ${(e as Error).message}]` }];
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

    return [{ type: 'text', filename, text: slideTexts.join('\n\n') }];
  } catch (e) {
    return [{ type: 'text', filename, text: `[PPTXの解析に失敗しました: ${(e as Error).message}]` }];
  }
}

function extractXMLText(xml: string): string {
  // Remove XML tags and extract text content
  const noTags = xml.replace(/<[^>]+>/g, ' ');
  // Decode common XML entities
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
  const text = buffer.toString('utf-8');
  return [{ type: 'text', filename, text }];
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
