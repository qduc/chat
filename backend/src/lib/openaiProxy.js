import fetch from 'node-fetch';
import { config } from '../env.js';

export async function proxyChatCompletion(req, res) {
  const body = req.body || {};
  if (!body.model) body.model = config.defaultModel;
  const stream = !!body.stream;

  const url = `${config.openaiBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.openaiApiKey}`
  };

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!stream || upstream.headers.get('content-type')?.includes('application/json')) {
      const json = await upstream.json();
      res.status(upstream.status).json(json);
      return;
    }

    // Stream (SSE) passthrough
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    upstream.body.on('data', chunk => {
      res.write(chunk);
    });
    upstream.body.on('end', () => {
      res.end();
    });
    upstream.body.on('error', err => {
      console.error('Upstream stream error', err);
      res.end();
    });
  } catch (e) {
    console.error('[proxy] error', e);
    res.status(500).json({ error: 'upstream_error', message: e.message });
  }
}
