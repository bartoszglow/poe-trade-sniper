import type { ListingPrice } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import { formatPriceAmount } from '../lib/format-price';

interface PriceTagProps {
  price: ListingPrice | null;
}

export function PriceTag({ price }: PriceTagProps) {
  const t = useT();
  if (!price) return <span className="text-xs text-ink-faint">{t('item.noPrice')}</span>;
  return (
    <span className="font-mono text-sm text-gold-bright">
      {formatPriceAmount(price.amount)}&nbsp;
      <span className="text-xs text-gold">{price.currency}</span>
    </span>
  );
}
