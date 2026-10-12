import { describe, it, expect } from 'bun:test';
import { total } from '../src/cart';

describe('total()', () => {
  it('adds the items and shipping', () => {
    expect(total([{ name: 'mug', price: 1200, qty: 2 }])).toBe(2900);
  });

  it('an empty cart still pays shipping', () => {
    expect(total([])).toBe(500);
  });
});
