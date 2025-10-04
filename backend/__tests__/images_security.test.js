import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import request from 'supertest';
import { imagesRouter } from '../src/routes/images.js';
import { config } from '../src/env.js';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { generateAccessToken } from '../src/middleware/auth.js';

const uploadDir = path.resolve('./data/images');
const samplePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y6XKZQAAAAASUVORK5CYII=',
  'base64'
);

function makeApp() {
  const app = express();
  app.use(imagesRouter);
  return app;
}

async function resetDatabase() {
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';
  resetDbCache();
  getDb();
}

async function clearUploads() {
  await fs.rm(uploadDir, { recursive: true, force: true });
  await fs.mkdir(uploadDir, { recursive: true });
}

describe('images security', () => {
  let owner;
  let otherUser;
  let ownerHeader;
  let otherHeader;

  beforeAll(() => {
    safeTestSetup();
  });

  beforeEach(async () => {
    await resetDatabase();
    await clearUploads();

    owner = createUser({ email: 'owner@example.com', passwordHash: 'pw', displayName: 'Owner' });
    otherUser = createUser({ email: 'other@example.com', passwordHash: 'pw', displayName: 'Other' });

    ownerHeader = `Bearer ${generateAccessToken(owner)}`;
    otherHeader = `Bearer ${generateAccessToken(otherUser)}`;
  });

  afterAll(() => {
    resetDbCache();
  });

  test('requires authentication to download an image', async () => {
    const app = makeApp();

    const upload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'secure.png', contentType: 'image/png' });

    assert.equal(upload.status, 200);
    assert.ok(Array.isArray(upload.body.images));
    const imageId = upload.body.images[0].id;

    const unauthenticated = await request(app).get(`/v1/images/${imageId}`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error, 'authentication_required');
  });

  test('prevents other users from accessing someone else\'s image', async () => {
    const app = makeApp();

    const upload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'secure.png', contentType: 'image/png' });

    assert.equal(upload.status, 200);
    const imageId = upload.body.images[0].id;

    const res = await request(app)
      .get(`/v1/images/${imageId}`)
      .set('Authorization', otherHeader);

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
  });

  test('allows owners to retrieve their images with auth', async () => {
    const app = makeApp();

    const upload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'secure.png', contentType: 'image/png' });

    assert.equal(upload.status, 200);
    const image = upload.body.images[0];

    const res = await request(app)
      .get(`/v1/images/${image.id}`)
      .set('Authorization', ownerHeader)
      .buffer(true);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(res.body.length, samplePng.length);
  });

  test('allows signed URL download without auth header', async () => {
    const app = makeApp();

    const upload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'secure.png', contentType: 'image/png' });

    assert.equal(upload.status, 200);
    const image = upload.body.images[0];

    const sign = await request(app)
      .get(`/v1/images/${image.id}/sign`)
      .set('Authorization', ownerHeader);

    assert.equal(sign.status, 200);
    const signedPath = sign.body.url;
    assert.equal(typeof signedPath, 'string');

    const download = await request(app)
      .get(signedPath)
      .buffer(true);

    assert.equal(download.status, 200);
    assert.equal(download.headers['content-type'], 'image/png');
    assert.ok(Buffer.isBuffer(download.body));
    assert.equal(download.body.length, samplePng.length);
  });

  test('rejects tampered signed URL tokens', async () => {
    const app = makeApp();

    const upload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'secure.png', contentType: 'image/png' });

    assert.equal(upload.status, 200);
    const image = upload.body.images[0];

    const sign = await request(app)
      .get(`/v1/images/${image.id}/sign`)
      .set('Authorization', ownerHeader);

    assert.equal(sign.status, 200);
    const signedUrl = new URL(sign.body.url, 'http://localhost');
    const token = signedUrl.searchParams.get('token');
    assert.ok(token);

    const tampered = `${token}xyz`;
    const res = await request(app)
      .get(`/v1/images/${image.id}?token=${tampered}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'invalid_token');
  });

  test('signed token cannot be reused for another image', async () => {
    const app = makeApp();

    const firstUpload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'first.png', contentType: 'image/png' });

    const secondUpload = await request(app)
      .post('/v1/images/upload')
      .set('Authorization', ownerHeader)
      .attach('images', samplePng, { filename: 'second.png', contentType: 'image/png' });

    assert.equal(firstUpload.status, 200);
    assert.equal(secondUpload.status, 200);

    const firstImage = firstUpload.body.images[0];
    const secondImage = secondUpload.body.images[0];

    const sign = await request(app)
      .get(`/v1/images/${firstImage.id}/sign`)
      .set('Authorization', ownerHeader);

    assert.equal(sign.status, 200);
    const signedUrl = new URL(sign.body.url, 'http://localhost');
    const token = signedUrl.searchParams.get('token');
    assert.ok(token);

    const res = await request(app)
      .get(`/v1/images/${secondImage.id}?token=${token}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'invalid_token');
  });
});
