// Static server for the resohead.com snapshot, plus the one dynamic bit:
// the Jetpack contact form, which posts to admin-ajax.php.
// No dependencies; Node 22+.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpam } from './spam.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const CONTACT_TO = process.env.CONTACT_TO || '';
const CONTACT_FROM = process.env.CONTACT_FROM || '';
const FORMS = JSON.parse(await readFile(join(HERE, 'forms.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf', '.7z': 'application/x-7z-compressed', '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

async function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  p = normalize(p).replace(/^(\.\.[/\\])+/, '');
  let file = join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return null;
  try {
    let s = await stat(file);
    if (s.isDirectory()) { file = join(file, 'index.html'); s = await stat(file); }
    return { file, size: s.size, mtime: s.mtime };
  } catch { return null; }
}

function sendFile(req, res, { file, size, mtime }, status = 200) {
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Last-Modified': mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    // Pages may change on redeploy; everything else is versioned by path.
    'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=604800',
  };
  if (status === 200 && req.headers['if-modified-since'] &&
      new Date(req.headers['if-modified-since']) >= new Date(mtime.toUTCString())) {
    res.writeHead(304, headers); return res.end();
  }
  const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    if (start < 0) start = 0;
    if (start >= size || end < start) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(status, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const recent = new Map(); // ip -> [timestamps], crude rate limit
function rateLimited(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter(t => now - t < 10 * 60_000);
  list.push(now);
  recent.set(ip, list);
  return list.length > 5;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendEmail(fields, replyTo, brief) {
  if (!RESEND_API_KEY || !CONTACT_TO || !CONTACT_FROM) return false;
  const text = (brief ? brief.checklist + '\n\n' : '') + fields.map(f => `${f.label}:\n${f.value}`).join('\n\n');
  const htmlBody = (brief ? `<pre>${escapeHtml(brief.checklist)}</pre>` : '') + fields.map(f => `<p><strong>${escapeHtml(f.label)}</strong><br>${escapeHtml(f.value).replace(/\n/g, '<br>')}</p>`).join('');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: CONTACT_FROM, to: CONTACT_TO.split(',').map(s => s.trim()),
      subject: brief?.subject || 'New feedback received from your website',
      text, html: htmlBody, ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return true;
}

// Matches what Jetpack's form script expects from admin-ajax.php.
async function handleContact(req, res) {
  const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const fail = (error, status = 400) => json(res, status, { success: false, data: { error } });
  if (rateLimited(ip)) return fail('Too many messages. Please try again later.', 429);

  const ctype = req.headers['content-type'] || '';
  let form;
  try {
    const body = await new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', c => { n += c.length; if (n > 1_000_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': ctype }, body }).formData();
  } catch { return fail('Please fill out the form correctly.'); }

  const spec = FORMS[form.get('contact-form-hash')] || Object.values(FORMS)[0];
  if (!spec) return fail('Please fill out the form correctly.');
  // Akismet's honeypot textarea: humans never see it.
  if ((form.get('ak_hp_textarea') || '').toString().trim()) return json(res, 200, { success: true, data: [] });

  const fields = [];
  let replyTo = '';
  for (const [name, f] of Object.entries(spec)) {
    const value = (form.get(name) || '').toString().trim().slice(0, 10_000);
    if (f.required && !value) return fail('This field is required.');
    if (f.type === 'email' && value) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail('Please enter a valid email address');
      replyTo = value;
    }
    fields.push({ label: f.label, value, type: f.type });
  }
  if (fields.every(f => !f.value)) return fail('The form you are trying to submit is empty.');

  const verdict = await checkSpam(fields);
  const record = { at: new Date().toISOString(), ip, fields: Object.fromEntries(fields.map(f => [f.label, f.value])), ...(verdict ? { spam: verdict } : {}) }; // verdict.brief holds the session brief check
  let saved = false;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(join(DATA_DIR, 'submissions.jsonl'), JSON.stringify(record) + '\n');
    saved = true;
  } catch (e) { console.error('could not save submission', e.message); }

  // Spam is kept in submissions.jsonl but not emailed (if it couldn't be
  // saved, it is emailed so nothing is lost). The sender sees the same
  // thank-you either way, so spammers learn nothing.
  if (verdict?.spam && saved) {
    console.log('spam not emailed', JSON.stringify(record));
    return json(res, 200, { success: true, data: fields });
  }

  let emailed = false;
  try { emailed = await sendEmail(fields, replyTo, verdict?.brief); } catch (e) { console.error(e.message); }
  if (!emailed) console.log('contact submission', JSON.stringify(record));
  if (!saved && !emailed) return fail('Connection issue while submitting the form. Check that you are connected to the Internet and try again.', 500);

  json(res, 200, { success: true, data: fields });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/wp-admin/admin-ajax.php') {
      if (req.method === 'POST' && url.searchParams.get('action') === 'grunion-contact-form') return await handleContact(req, res);
      return json(res, 400, { success: false });
    }
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
    }
    const found = await resolveFile(url.pathname);
    if (found) return sendFile(req, res, found);
    // WordPress serves pages with and without a trailing slash.
    if (!url.pathname.endsWith('/') && !extname(url.pathname)) {
      const dir = await resolveFile(url.pathname + '/');
      if (dir) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
    }
    const notFound = await resolveFile('/404.html');
    return sendFile(req, res, notFound, 404);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); }
    res.end();
  }
});

server.listen(PORT, () => console.log(`resohead listening on :${PORT}`));
