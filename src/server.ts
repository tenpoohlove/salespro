import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { extractContent } from './extractors';
import { analyzeContent } from './analyze';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = [
      '.pdf', '.docx', '.doc', '.pptx', '.ppt',
      '.txt', '.md', '.srt', '.vtt',
      '.png', '.jpg', '.jpeg', '.webp', '.gif',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`対応していないファイル形式です: ${ext}`));
    }
  },
});

app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/api/health', (_req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  // Real Anthropic API keys are 100+ characters; short ones are placeholders
  const hasKey = key.startsWith('sk-ant') && key.length > 50;
  res.json({ status: 'ok', model: 'claude-sonnet-4-6', hasKey });
});

// Save API key to .env
app.post('/api/setup', express.json(), (req, res) => {
  const { apiKey } = req.body as { apiKey: string };
  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    res.status(400).json({ error: 'Invalid API key format (must start with sk-ant)' });
    return;
  }
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(process.cwd(), '.env');
  const content = `ANTHROPIC_API_KEY=${apiKey}\nPORT=3000\n`;
  fs.writeFileSync(envPath, content, 'utf8');
  process.env.ANTHROPIC_API_KEY = apiKey;
  res.json({ success: true });
});

// Main analysis endpoint - uses SSE for streaming
app.post(
  '/api/analyze',
  upload.array('files', 10),
  async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const sendEvent = (data: string) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendDone = () => {
      res.write('data: [DONE]\n\n');
      res.end();
    };

    try {
      const files = req.files as Express.Multer.File[] | undefined;
      const extraText = (req.body.text as string) || '';

      if ((!files || files.length === 0) && !extraText.trim()) {
        sendEvent('**エラー:** ファイルまたはテキストが必要です。');
        sendDone();
        return;
      }

      // Extract content from all files
      const allContents = [];
      for (const file of files || []) {
        const bufferName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const contents = await extractContent(file.buffer, bufferName);
        allContents.push(...contents);
      }

      // Stream analysis results
      for await (const chunk of analyzeContent(allContents, extraText)) {
        sendEvent(chunk);
      }

      sendDone();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '不明なエラー';
      sendEvent(`\n\n**エラーが発生しました:** ${msg}`);
      sendDone();
    }
  }
);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 セールスアドバイザー起動中`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   モデル: claude-sonnet-4-6 + Constitutional Review`);
  console.log(`   対応形式: PDF, DOCX, PPTX, TXT, PNG, JPG, WebP\n`);
});
