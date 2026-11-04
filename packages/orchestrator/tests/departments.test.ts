import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDepartment } from '@warden/db/schema';

describe('normalizeDepartment', () => {
  it('keeps canonical lowercase departments', () => {
    for (const d of [
      'executive',
      'tech',
      'infra',
      'marketing',
      'sales',
      'hr',
      'ops',
      'support',
      'finance',
      'product',
    ]) {
      assert.equal(normalizeDepartment(d), d);
    }
  });

  it('lowercases legacy Title-case departments', () => {
    assert.equal(normalizeDepartment('Tech'), 'tech');
    assert.equal(normalizeDepartment('Marketing'), 'marketing');
    assert.equal(normalizeDepartment('Product'), 'product');
    assert.equal(normalizeDepartment('EXECUTIVE'), 'executive');
  });

  it('maps Operations to the ops check value', () => {
    assert.equal(normalizeDepartment('Operations'), 'ops');
    assert.equal(normalizeDepartment('operations'), 'ops');
  });

  it('falls back to tech for unknown or missing values', () => {
    assert.equal(normalizeDepartment('bogus'), 'tech');
    assert.equal(normalizeDepartment(''), 'tech');
    assert.equal(normalizeDepartment(undefined), 'tech');
  });
});
