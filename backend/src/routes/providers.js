import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  listProviders,
  getProviderById,
  createProvider,
  updateProvider,
  setDefaultProvider,
  deleteProvider,
} from '../db/index.js';

export const providersRouter = Router();

// Base path: /v1/providers

providersRouter.get('/v1/providers', (req, res) => {
  try {
    const rows = listProviders();
    res.json({ providers: rows });
  } catch (err) {
    res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

providersRouter.get('/v1/providers/:id', (req, res) => {
  try {
    const row = getProviderById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

providersRouter.post('/v1/providers', (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const provider_type = String(body.provider_type || '').trim();
    if (!name || !provider_type) {
      return res.status(400).json({ error: 'invalid_request', message: 'name and provider_type are required' });
    }
    const id = body.id ? String(body.id) : uuidv4();
    const created = createProvider({
      id,
      name,
      provider_type,
      api_key: body.api_key ?? null,
      base_url: body.base_url ?? null,
      enabled: body.enabled !== undefined ? !!body.enabled : true,
      is_default: !!body.is_default,
      extra_headers: typeof body.extra_headers === 'object' && body.extra_headers !== null ? body.extra_headers : {},
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {},
    });
    res.status(201).json(created);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'conflict', message: 'Provider with same id or name exists' });
    }
    res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

providersRouter.put('/v1/providers/:id', (req, res) => {
  try {
    const body = req.body || {};
    const updated = updateProvider(req.params.id, {
      name: body.name,
      provider_type: body.provider_type,
      api_key: body.api_key,
      base_url: body.base_url,
      enabled: body.enabled,
      is_default: body.is_default,
      extra_headers: body.extra_headers,
      metadata: body.metadata,
    });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

providersRouter.post('/v1/providers/:id/default', (req, res) => {
  try {
    const row = setDefaultProvider(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

providersRouter.delete('/v1/providers/:id', (req, res) => {
  try {
    const ok = deleteProvider(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'internal_server_error', message: err.message });
  }
});

