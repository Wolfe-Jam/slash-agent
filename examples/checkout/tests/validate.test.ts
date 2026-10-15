import { describe, it, expect } from 'bun:test';
import { validateCart } from '../src/validate';

describe('validateCart()', () => {
  it('accepts a good cart', () => {
    expect(validateCart({ items: [{ name: 'mug', price: 1200, qty: 2 }] })).toEqual({ ok: true, cart: { items: [{ name: 'mug', price: 1200, qty: 2 }] } });
  });

  it('says which field is missing or the wrong type', () => {
    expect(validateCart({ items: [{ price: '12', qty: 1 }] })).toEqual({ ok: false, errors: ['items.0.name: name is required', 'items.0.price: price must be a number'] });
  });

  it('needs a quantity of at least 1', () => {
    expect(validateCart({ items: [{ name: 'mug', price: 1200, qty: 0 }] })).toEqual({ ok: false, errors: ['items.0.qty: qty must be at least 1'] });
  });

  it('refuses an empty cart', () => {
    expect(validateCart({ items: [] })).toEqual({ ok: false, errors: ['items: the cart is empty'] });
  });
});
