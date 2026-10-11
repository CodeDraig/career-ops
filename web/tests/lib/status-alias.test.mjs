import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { canonStatus } from '../../src/lib/status-alias.mjs';

const states = yaml.load(readFileSync(new URL('../../../templates/states.yml', import.meta.url), 'utf8')).states;
test('current canonical states resolve case-insensitively', () => {
  for (const state of states) {
    assert.equal(canonStatus(state.label), state.label.toUpperCase());
    assert.equal(canonStatus(` ${state.id} `), state.label.toUpperCase());
    assert.equal(state.aliases, undefined);
  }
});
test('legacy aliases and malformed statuses are never promoted to canonical stages', () => {
  const labels = new Set(states.map(s => s.label.toUpperCase()));
  for (const value of ['aplicado', 'entrevista', 'teklif', 'accepted', 'hold', 'repost', '**Applied**', 'Applied 2026-01-01', '', '—']) {
    assert.equal(labels.has(canonStatus(value)), false, value);
  }
});
