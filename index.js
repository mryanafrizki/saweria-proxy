import { createServer } from 'node:http';
import wreq from 'wreq-js';

const PORT = process.env.PORT || 3001;
const PROXY_SECRET = process.env.PROXY_SECRET || 'change-me';
const SAWERIA_BASE = 'https://backend.saweria.co';

const BROWSER_HEADERS = {
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Origin': 'https://saweria.co',
  'Referer': 'https://saweria.co/',
  'Sec-Ch-Ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
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

  // Forward to Saweria
  const targetUrl = SAWERIA_BASE + req.url;
  const body = req.method === 'POST' ? await readBody(req) : undefined;

  try {
    const headers = {
      ...BROWSER_HEADERS,
      'Authorization': saweriaToken,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await wreq.fetch(targetUrl, {
      method: req.method,
      headers,
      body: body || undefined,
      impersonate: 'chrome_131',
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
