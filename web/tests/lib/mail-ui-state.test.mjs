import test from 'node:test';
import assert from 'node:assert/strict';
import { classificationLabel, confidenceLabel, replyApplication, syncAppFilter } from '../../src/lib/mail-ui-state.mjs';

test('classification objects are rendered by their display type, never passed to React as children', () => {
  assert.equal(classificationLabel({ type: 'Interview', evidence: ['schedule an interview'] }), 'Interview');
  assert.equal(classificationLabel('Offer'), 'Offer');
  assert.equal(classificationLabel(null), 'Unclassified');
});

test('matcher confidence bands are shown as names, not invented percentages', () => {
  assert.equal(confidenceLabel('high'), 'High confidence');
  assert.equal(confidenceLabel('medium'), 'Medium confidence');
  assert.equal(confidenceLabel('low'), 'Low confidence');
  assert.equal(confidenceLabel(undefined), 'Confidence unavailable');
});

test('an unmatched reply cannot inherit the currently selected inbox application', () => {
  assert.equal(replyApplication({ num: 12, company: 'Example' }), '12');
  assert.equal(replyApplication(null), '');
  assert.equal(replyApplication({ company: 'Example' }), '');
});

test('inbox view filters are numeric and leave an empty filter unbound', () => {
  assert.equal(syncAppFilter('12'), 12);
  assert.equal(syncAppFilter(''), undefined);
});
