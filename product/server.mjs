import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const password = process.env.SHOP_PASSWORD;
if (!password || password.length < 16) {
  throw new Error('Set SHOP_PASSWORD to a unique password of at least 16 characters.');
}
const digest = value => createHash('sha256').update(value).digest();
const expected = digest('Basic ' + Buffer.from('owner:' + password).toString('base64'));
const html = readFileSync(new URL('./index.html', import.meta.url));
const db = new DatabaseSync(process.env.SHOP_DB || 'wholesale.sqlite');
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS shop (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL,
    snapshot TEXT NOT NULL CHECK (json_valid(snapshot))
  );
`);
const initial = { products: [], entries: [], shop: { name: 'Dheeraj Wholesale', gstin: '', address: '' }, next: 1 };
db.prepare('INSERT OR IGNORE INTO shop VALUES (1, 0, ?)').run(JSON.stringify(initial));
const read = db.prepare('SELECT revision, snapshot FROM shop WHERE id = 1');
const write = db.prepare('UPDATE shop SET revision = revision + 1, snapshot = ? WHERE id = 1 AND revision = ?');
const maxBytes = 8 * 1024 * 1024;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const integer = value => Number.isSafeInteger(value) && value >= 0;
function valid(state) {
  return state && Array.isArray(state.products) && Array.isArray(state.entries) &&
    integer(state.next) && state.next > 0 &&
    ['name', 'gstin', 'address'].every(key => typeof state.shop?.[key] === 'string') &&
    state.products.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' &&
      typeof p.barcode === 'string' && integer(p.pack) && p.pack > 0 &&
      integer(p.stock) && integer(p.carton) && integer(p.loose) && Number.isFinite(p.cost) && p.cost >= 0) &&
    new Set(state.products.map(p => p.id)).size === state.products.length &&
    state.entries.every((e, index) => e && e.id === index + 1 && typeof e.type === 'string') &&
    state.next === state.entries.length + 1;
}

createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!timingSafeEqual(digest(req.headers.authorization || ''), expected)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Dheeraj Wholesale", charset="UTF-8"' });
    return res.end('Sign in as owner.');
  }
  try {
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.url !== '/api/state') return json(res, 404, { error: 'Not found' });
    if (req.method === 'GET') {
      const { revision, snapshot } = read.get();
      return json(res, 200, { revision, data: JSON.parse(snapshot) });
    }
    if (req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed' });
    if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'Expected JSON' });
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) return json(res, 413, { error: 'Workspace payload too large' });
      chunks.push(chunk);
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }
    if (!integer(payload?.revision) || !valid(payload.data)) return json(res, 400, { error: 'Invalid workspace' });
    const result = write.run(JSON.stringify(payload.data), payload.revision);
    if (!result.changes) return json(res, 409, { error: 'The workspace changed. Reload and review.' });
    return json(res, 200, { revision: payload.revision + 1 });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'Workspace request failed' });
  }
}).listen(Number(process.env.PORT || 3000), '127.0.0.1');
