export interface Item {
  name: string;
  /** Price in cents. */
  price: number;
  qty: number;
}

/**
 * Order total in cents: the items, minus the coupon, plus shipping.
 * The coupon is a percentage off.
 */
export function total(items: Item[], couponPercent = 0, shipping = 500): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.round(((subtotal + shipping) * couponPercent) / 100);
  return subtotal - discount + shipping;
}
