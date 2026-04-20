import { createServer } from 'node:http';
import wreq from 'wreq-js';

const PORT = process.env.PORT || 3001;
const PROXY_SECRET = process.env.PROXY_SECRET || 'change-me';
const SAWERIA_BASE = 'https://backend.saweria.co';

// Rotate browser profiles to look like different users
const BROWSER_PROFILES = [
  {
    impersonate: 'chrome_131',
    headers: {
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Not_A Brand";v="24", "Chromium";v="131"',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  },
  {
    impersonate: 'chrome_131',
    headers: {
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Not_A Brand";v="24", "Chromium";v="131"',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  },
  {
    impersonate: 'chrome_131',
    headers: {
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Not_A Brand";v="24", "Chromium";v="131"',
      'Sec-Ch-Ua-Platform': '"Linux"',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  },
];

function getRandomProfile() {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

function randomDelay(min = 100, max = 500) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

// Simple in-memory rate limiter: max 10 requests per 10 seconds per token
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 10_000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(token) {
  const now = Date.now();
  const key = token.substring(token.length - 20); // last 20 chars as key
  let entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(key, entry);
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Cleanup old entries every 30s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(key);
  }
}, 30_000);

const BASE_HEADERS = {
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Origin': 'https://saweria.co',
  'Referer': 'https://saweria.co/',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret, X-Saweria-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (req.url === '/' && req.method === 'GET') {
    return sendJson(res, 200, { status: 'ok', service: 'saweria-proxy' });
  }

  // Auth check
  const proxySecret = req.headers['x-proxy-secret'];
  if (proxySecret !== PROXY_SECRET) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  // Extract Saweria token from header
  const saweriaToken = req.headers['x-saweria-token'];
  if (!saweriaToken) {
    return sendJson(res, 400, { error: 'Missing X-Saweria-Token header' });
  }

  // Rate limit per token
  if (!checkRateLimit(saweriaToken)) {
    return sendJson(res, 429, { error: 'Rate limit exceeded. Max 10 requests per 10 seconds.' });
  }

  // Random delay to mimic human behavior
  await randomDelay(100, 400);

  // Forward to Saweria with random browser profile
  const profile = getRandomProfile();
  const targetUrl = SAWERIA_BASE + req.url;
  const body = req.method === 'POST' ? await readBody(req) : undefined;

  try {
    const headers = {
      ...BASE_HEADERS,
      ...profile.headers,
      'Authorization': saweriaToken,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await wreq.fetch(targetUrl, {
      method: req.method,
      headers,
      body: body || undefined,
      impersonate: profile.impersonate,
    });

    const responseBody = await response.text();

    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    });
    res.end(responseBody);
  } catch (err) {
    console.error('Proxy error:', err.message);
    sendJson(res, 502, { error: 'Proxy request failed', detail: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Saweria proxy listening on port ${PORT}`);
});
