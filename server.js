// MedLingua AI - backend with history, PDF upload/parse, export, and basic hardening
// Usage: copy .env.example -> .env and set OPENAI_API_KEY and optional BACKEND_API_KEY

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || '';

// Ensure data dir exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Initialize SQLite DB
const dbPath = path.join(DATA_DIR, 'history.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create table if not exists
db.prepare(
  `CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    result TEXT NOT NULL,
    level TEXT,
    tone TEXT,
    created_at INTEGER NOT NULL
  )`
).run();

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Simple rate limiter
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 }); // 60 requests per minute
app.use(limiter);

// Multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireApiKeyIfConfigured(req, res, next) {
  if (!BACKEND_API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key || req.headers.authorization;
  if (!key) return res.status(401).json({ error: 'Missing API key' });
  // allow 'Bearer KEY' or raw key
  const raw = ('' + key).replace(/^Bearer\s+/i, '').trim();
  if (raw !== BACKEND_API_KEY) return res.status(403).json({ error: 'Invalid API key' });
  next();
}

app.get('/', (req, res) => {
  res.send('MedLingua AI backend is running.');
});

// Parse and return text from uploaded PDF
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const data = await pdfParse(req.file.buffer);
    return res.json({ text: data.text });
  } catch (err) {
    console.error('PDF parse error', err);
    return res.status(500).json({ error: 'Failed to parse PDF' });
  }
});

// Save history helper
function saveHistory(text, result, level, tone) {
  const stmt = db.prepare('INSERT INTO history (text, result, level, tone, created_at) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(text, result, level, tone, Date.now());
  return info.lastInsertRowid;
}

// Get history list
app.get('/api/history', requireApiKeyIfConfigured, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, substr(text,1,200) as text_snippet, level, tone, created_at FROM history ORDER BY created_at DESC LIMIT 200').all();
    return res.json({ items: rows });
  } catch (err) {
    console.error('DB history error', err);
    return res.status(500).json({ error: 'DB error' });
  }
});

// Get a single history entry
app.get('/api/history/:id', requireApiKeyIfConfigured, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const row = db.prepare('SELECT * FROM history WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  return res.json({ item: row });
});

// Export history entry as txt or pdf
app.get('/api/history/:id/export', requireApiKeyIfConfigured, (req, res) => {
  const id = Number(req.params.id);
  const format = (req.query.format || 'txt').toLowerCase();
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const row = db.prepare('SELECT * FROM history WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const filenameBase = `medlingua-${id}`;
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(12).text('Original text:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(row.text);
    doc.moveDown(1);
    doc.fontSize(12).text('Explanation:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(row.result);
    doc.end();
  } else {
    const txt = `Original text:\n\n${row.text}\n\nExplanation:\n\n${row.result}`;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.txt"`);
    res.send(txt);
  }
});

// Save an explanation explicitly (if frontend wants to save current output)
app.post('/api/save', requireApiKeyIfConfigured, (req, res) => {
  const { text, result, level, tone } = req.body || {};
  if (!text || !result) return res.status(400).json({ error: 'text and result are required' });
  try {
    const id = saveHistory(text, result, level || '', tone || '');
    return res.json({ id });
  } catch (err) {
    console.error('DB save error', err);
    return res.status(500).json({ error: 'Failed to save' });
  }
});

// Translate endpoint (proxies to OpenAI). It will save history on success.
app.post('/api/translate', async (req, res) => {
  const { text, level = 'basic', tone = 'neutral' } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });

  if (!OPENAI_KEY) {
    // For demo: return 501 so frontend can fallback to local translator
    return res.status(501).json({ error: 'OPENAI_API_KEY not configured on server' });
  }

  try {
    const systemPrompt = `You are MedLingua AI, an assistant that translates medical text into clear, calm, non-alarming plain language for patients. Always avoid making diagnoses; provide context, suggested questions to ask a clinician, and a brief one-line summary.`;
    const userPrompt = `Original medical text:\n\"\"\"${text}\"\"\"\n\nLevel: ${level}\nTone: ${tone}\n\nRespond with a calm, plain-language explanation, suggested next steps, and a short summary.`;

    const payload = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 700,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error', response.status, errText);
      return res.status(502).json({ error: 'OpenAI API error', details: errText });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';

    // Save to history
    try {
      const id = saveHistory(text, content, level, tone);
      return res.json({ result: content, id });
    } catch (err) {
      console.error('Failed to save history', err);
      return res.json({ result: content });
    }
  } catch (err) {
    console.error('/api/translate error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`MedLingua AI backend listening on port ${PORT}`);
});
