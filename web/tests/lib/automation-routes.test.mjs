import '../helpers/web-ts-alias-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [{ GET, POST }, { GET: getConfig, PUT: putConfig }, { GET: listReviews }, { GET: getReview, POST: actReview }, store] = await Promise.all([
  import('../../src/app/api/automation/route.ts'),
  import('../../src/app/api/automation/config/route.ts'),
  import('../../src/app/api/automation/review/route.ts'),
  import('../../src/app/api/automation/review/[id]/route.ts'),
  import('../../../lib/automation/store.mjs'),
]);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-web-api-'));
const oldEnv = { ...process.env };
process.env.CAREER_OPS_ROOT = root;
process.env.CAREER_OPS_CODE_ROOT = path.resolve(import.meta.dirname, '../../..');
const jsonRequest = (url, body, origin = 'http://localhost') => new Request(`http://localhost${url}`, {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('automation status and config routes use the separate data root', async () => {
  const status = await (await GET()).json();
  assert.equal(status.config.enabled, false);
  assert.ok(status.blockers.some((item) => item.code === 'profile_setup'));
  assert.deepEqual((await (await getConfig()).json()).mailAccounts, []);
  const changed = await POST(jsonRequest('/api/automation', { action: 'config', patch: { timezone: 'UTC', dailyRoles: 4 } }));
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).dailyRoles, 4);
  assert.equal((await POST(jsonRequest('/api/automation', { action: 'pause' }))).status, 200);
  assert.equal((await (await GET()).json()).config.paused, true);
  const put = await putConfig(jsonRequest('/api/automation/config', { timezone: 'Europe/London' }));
  assert.equal(put.status, 200);
  assert.equal((await put.json()).timezone, 'Europe/London');
  assert.ok(!fs.existsSync(path.join(root, 'cv.md')), 'API must not initialize user profile files');
});

test('automation controls reject cross-origin, unknown and oversized requests', async () => {
  assert.equal((await POST(jsonRequest('/api/automation', { action: 'pause' }, 'https://elsewhere.test'))).status, 403);
  assert.equal((await POST(jsonRequest('/api/automation', { action: 'arbitrary' }))).status, 400);
  const tooLarge = new Request('http://localhost/api/automation', { method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(1_000_001) }) });
  assert.equal((await POST(tooLarge)).status, 413);
});

test('review API lists items and reports stale revisions with current review', async () => {
  const id = 'review-fixture';
  await store.withState(root, (state) => state.reviews.push({ id, key: id, type: 'blocked_input', state: 'open', revision: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: 'Input needed' }));
  const listed = await (await listReviews(new Request('http://localhost/api/automation/review'))).json();
  assert.equal(listed.length, 1);
  assert.equal((await (await getReview(new Request('http://localhost'), { params: Promise.resolve({ id }) })).json()).revision, 2);
  const stale = await actReview(jsonRequest(`/api/automation/review/${id}`, { action: 'reviewed', expectedRevision: 1 }), { params: Promise.resolve({ id }) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.revision, 2);
  const invalid = await actReview(jsonRequest(`/api/automation/review/${id}`, { action: 'reviewed' }), { params: Promise.resolve({ id }) });
  assert.equal(invalid.status, 400);
});

test.after(() => {
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
  Object.assign(process.env, oldEnv);
  fs.rmSync(root, { recursive: true, force: true });
});
