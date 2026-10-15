import { z } from 'zod';

const Item = z.object({
  name: z.string({ required_error: 'name is required' }).min(1, { message: 'name is required' }),
  /** Price in cents. */
  price: z.number({ invalid_type_error: 'price must be a number' }).int().nonnegative(),
  qty: z.number().int().positive({ message: 'qty must be at least 1' }),
});

const Cart = z.object({
  items: z.array(Item).min(1, { message: 'the cart is empty' }),
});

export type Cart = z.infer<typeof Cart>;

/** Check a cart from the outside world. Errors read "path: message". */
export function validateCart(input: unknown): { ok: true; cart: Cart } | { ok: false; errors: string[] } {
  const result = Cart.safeParse(input);
  if (result.success) return { ok: true, cart: result.data };
  return { ok: false, errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) };
}
