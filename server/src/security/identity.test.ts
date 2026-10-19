import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLoginIdentifier, normalizePhone } from './identity.js';

test('normalizes Yemeni and international phone representations to E.164', () => {
  assert.equal(normalizePhone('777 123 456'), '+967777123456');
  assert.equal(normalizePhone('0777-123-456'), '+967777123456');
  assert.equal(normalizePhone('00967 777 123 456'), '+967777123456');
  assert.equal(normalizePhone('٠٠٩٦٧٧٧٧١٢٣٤٥٦'), '+967777123456');
  assert.equal(normalizePhone('+1 (202) 555-0123'), '+12025550123');
});

test('rejects ambiguous or invalid identifiers', () => {
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('not-a-phone'), null);
  assert.equal(normalizeLoginIdentifier('not-an-email'), null);
});

test('normalizes email identifiers without changing phone behavior', () => {
  assert.equal(normalizeLoginIdentifier(' User@Example.EDU '), 'user@example.edu');
  assert.equal(normalizeLoginIdentifier('777123456'), '+967777123456');
});
