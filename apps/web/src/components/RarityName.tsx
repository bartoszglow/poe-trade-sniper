/** Game rarity → theme color token. Unknown rarities render as normal. */
const RARITY_CLASSES: Record<string, string> = {
  Normal: 'text-rarity-normal',
  Magic: 'text-rarity-magic',
  Rare: 'text-rarity-rare',
  Unique: 'text-rarity-unique',
  Currency: 'text-rarity-currency',
};

interface RarityNameProps {
  name: string;
  rarity: string | null;
}

export function RarityName({ name, rarity }: RarityNameProps) {
  const colorClass = (rarity && RARITY_CLASSES[rarity]) ?? 'text-rarity-normal';
  return <span className={`font-medium ${colorClass}`}>{name}</span>;
}
