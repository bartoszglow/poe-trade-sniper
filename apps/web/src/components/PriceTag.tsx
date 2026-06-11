import type { ListingPrice } from '@poe-sniper/shared';

interface PriceTagProps {
  price: ListingPrice | null;
}

export function PriceTag({ price }: PriceTagProps) {
  if (!price) return <span className="text-xs text-ink-faint">no price</span>;
  return (
    <span className="font-mono text-sm text-gold-bright">
      {price.amount}&nbsp;
      <span className="text-xs text-gold">{price.currency}</span>
    </span>
  );
}
