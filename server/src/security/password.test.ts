import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, validatePassword, verifyPassword } from './password.js';

describe('password security', () => {
  it('rejects short and common passwords', () => {
    assert.ok(validatePassword('password123').length > 0);
    assert.ok(validatePassword('قصيرة1').length > 0);
  });

  it('accepts 8 characters and rejects more than 40 characters', () => {
    assert.deepEqual(validatePassword('Abcd1234'), []);
    assert.deepEqual(validatePassword(`A1${'x'.repeat(38)}`), []);
    assert.ok(validatePassword(`A1${'x'.repeat(39)}`).length > 0);
  });

  it('accepts a strong unicode password and verifies Argon2id hashes', async () => {
    const password = 'مسار-آمن-للتعلم-2026';
    assert.equal(validatePassword(password).length, 0);
    const passwordHash = await hashPassword(password);
    assert.equal(passwordHash.startsWith('$argon2id$'), true);
    assert.equal(await verifyPassword(passwordHash, password), true);
    assert.equal(await verifyPassword(passwordHash, `${password}!`), false);
  });
});
