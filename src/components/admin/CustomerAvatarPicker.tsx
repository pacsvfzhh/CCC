export type CustomerAvatarPickerTheme = 'orange' | 'emerald';
export type CustomerAvatarPickerVariant = 'regular' | 'vip';

interface AvatarOption {
  emoji: string;
  label: string;
}

interface CustomerAvatarPickerProps {
  value: string;
  onChange: (avatar: string) => void;
  theme: CustomerAvatarPickerTheme;
  variant: CustomerAvatarPickerVariant;
}

const regularAvatarOptions: AvatarOption[] = [
  { emoji: '🧑', label: 'Classic' },
  { emoji: '👨', label: 'Modern' },
  { emoji: '👩', label: 'Modern Muse' },
  { emoji: '🧒', label: 'Young' },
  { emoji: '👦', label: 'Bright' },
  { emoji: '👧', label: 'Bright Muse' },
  { emoji: '👴', label: 'Distinguished' },
  { emoji: '👵', label: 'Distinguished Muse' },
  { emoji: '👨‍💼', label: 'Executive' },
  { emoji: '👩‍💼', label: 'Executive Muse' },
  { emoji: '👨‍🔧', label: 'Builder' },
  { emoji: '👩‍🔧', label: 'Builder Muse' },
  { emoji: '👨‍⚕️', label: 'Caregiver' },
  { emoji: '👩‍⚕️', label: 'Caregiver Muse' },
  { emoji: '👨‍🎓', label: 'Scholar' },
  { emoji: '👩‍🎓', label: 'Scholar Muse' },
  { emoji: '👨‍🏫', label: 'Mentor' },
  { emoji: '👩‍🏫', label: 'Mentor Muse' },
  { emoji: '👨‍🌾', label: 'Gardener' },
  { emoji: '👩‍🌾', label: 'Gardener Muse' },
  { emoji: '👨‍🍳', label: 'Chef' },
  { emoji: '👩‍🍳', label: 'Chef Muse' },
  { emoji: '👨‍🎨', label: 'Artist' },
  { emoji: '👩‍🎨', label: 'Artist Muse' },
  { emoji: '👨‍💻', label: 'Maker' },
  { emoji: '👩‍💻', label: 'Maker Muse' },
  { emoji: '🦸‍♂️', label: 'Guardian' },
  { emoji: '🦸‍♀️', label: 'Guardian Muse' },
  { emoji: '🧙‍♂️', label: 'Mystic' },
  { emoji: '🧙‍♀️', label: 'Mystic Muse' },
  { emoji: '🧚‍♂️', label: 'Dreamer' },
  { emoji: '🧚‍♀️', label: 'Dreamer Muse' },
  { emoji: '🧛‍♂️', label: 'Nightfall' },
  { emoji: '🧛‍♀️', label: 'Nightfall Muse' },
  { emoji: '🧜‍♂️', label: 'Ocean' },
  { emoji: '🧜‍♀️', label: 'Ocean Muse' },
  { emoji: '🧝‍♂️', label: 'Wanderer' },
  { emoji: '🧝‍♀️', label: 'Wanderer Muse' },
  { emoji: '👼', label: 'Serene' },
  { emoji: '🤴', label: 'Regal' },
  { emoji: '👸', label: 'Regal Muse' },
  { emoji: '🤵', label: 'Formal' },
  { emoji: '👰', label: 'Formal Muse' },
  { emoji: '🤶', label: 'Winter' },
  { emoji: '🎅', label: 'Festive' },
  { emoji: '🤠', label: 'Frontier' },
  { emoji: '🥷', label: 'Shadow' },
  { emoji: '👮', label: 'Protector' },
  { emoji: '🕵️', label: 'Observer' },
  { emoji: '💂', label: 'Sentinel' },
];

const vipAvatarOptions: AvatarOption[] = [
  { emoji: '👨‍💼', label: 'Gold Executive' },
  { emoji: '👩‍💼', label: 'Gold Executive Muse' },
  { emoji: '🧑‍💼', label: 'Platinum Executive' },
  { emoji: '👨‍🎓', label: 'Diamond Scholar' },
  { emoji: '👩‍🎓', label: 'Diamond Scholar Muse' },
  { emoji: '🧑‍🎓', label: 'Platinum Scholar' },
  { emoji: '👨‍⚖️', label: 'Crown Counsel' },
  { emoji: '👩‍⚖️', label: 'Crown Counsel Muse' },
  { emoji: '🧑‍⚖️', label: 'Royal Counsel' },
  { emoji: '👨‍🔬', label: 'Prism Scientist' },
  { emoji: '👩‍🔬', label: 'Prism Scientist Muse' },
  { emoji: '🧑‍🔬', label: 'Prism Researcher' },
  { emoji: '🤵', label: 'Velvet Formal' },
  { emoji: '🤵‍♂️', label: 'Velvet Formal Elite' },
  { emoji: '🤵‍♀️', label: 'Velvet Formal Muse' },
  { emoji: '👰', label: 'Pearl Formal' },
  { emoji: '👰‍♂️', label: 'Pearl Formal Elite' },
  { emoji: '👰‍♀️', label: 'Pearl Formal Muse' },
  { emoji: '🤴', label: 'Royal Heir' },
  { emoji: '👸', label: 'Royal Heiress' },
  { emoji: '🦸‍♂️', label: 'Apex Guardian' },
  { emoji: '🦸‍♀️', label: 'Apex Guardian Muse' },
  { emoji: '🦸', label: 'Apex Champion' },
  { emoji: '🧙‍♂️', label: 'Arcane Master' },
  { emoji: '🧙‍♀️', label: 'Arcane Master Muse' },
  { emoji: '🧙', label: 'Arcane Sage' },
  { emoji: '🧚‍♂️', label: 'Starlight Keeper' },
  { emoji: '🧚‍♀️', label: 'Starlight Keeper Muse' },
  { emoji: '🧚', label: 'Starlight Spirit' },
  { emoji: '🧛‍♂️', label: 'Obsidian Noble' },
  { emoji: '🧛‍♀️', label: 'Obsidian Noble Muse' },
  { emoji: '🧛', label: 'Obsidian Sovereign' },
];

const backgrounds = [
  ['#182235', '#3b2c5f'],
  ['#202b3f', '#14536b'],
  ['#30213d', '#75456d'],
  ['#1b3540', '#24635e'],
  ['#382b24', '#85552f'],
  ['#202a35', '#405d7b'],
];

const vipBackgrounds = [
  ['#281a3d', '#a25263'],
  ['#182c45', '#b16c2c'],
  ['#302044', '#5f4fb1'],
  ['#142f37', '#ad7b2e'],
  ['#3b202c', '#b64c62'],
  ['#202b43', '#2d8c87'],
];

const skinTones = ['#f7c9a9', '#eeb18f', '#d9916c', '#b96f50', '#89513d', '#f3d0bb'];
const hairTones = ['#1d1720', '#3a241b', '#6e3f28', '#b66a35', '#e3ad58', '#493e63'];
const shirtTones = ['#5b6ee1', '#d45c83', '#278a83', '#d88d3d', '#7657b5', '#3d8bb8'];
const vipShirtTones = ['#b98938', '#d59b42', '#8666c5', '#b65368', '#358f91', '#d4b260'];

const hairStyles = [
  'M15 31C13 17 20 8 32 8s19 9 17 23c-3-5-6-7-10-8-5 6-13 8-24 8Z',
  'M14 31C13 17 21 8 32 8c11 0 19 8 18 23l-5 3-2-14c-8 5-16 6-26 4l-1 12Z',
  'M15 27C16 14 23 8 33 8c11 0 17 8 17 20-3-5-6-7-8-8-4 4-11 7-24 7Z',
  'M16 29C14 16 21 7 33 7c12 0 18 9 16 23l-4-4-2-10c-7 3-15 4-25 2l-1 11Z',
];

const themeStyles: Record<CustomerAvatarPickerTheme, {
  panel: string;
  idle: string;
  selected: string;
  accent: string;
}> = {
  orange: {
    panel: 'border-orange-300/20 bg-orange-950/10',
    idle: 'border-orange-200/10 bg-slate-900/70 hover:border-orange-300/60 hover:bg-orange-500/10',
    selected: 'border-orange-300 bg-orange-500/20 ring-2 ring-orange-300/80 shadow-lg shadow-orange-500/20',
    accent: 'text-orange-200',
  },
  emerald: {
    panel: 'border-emerald-300/20 bg-emerald-950/10',
    idle: 'border-emerald-200/10 bg-slate-900/70 hover:border-emerald-300/60 hover:bg-emerald-500/10',
    selected: 'border-emerald-300 bg-emerald-500/20 ring-2 ring-emerald-300/80 shadow-lg shadow-emerald-500/20',
    accent: 'text-emerald-200',
  },
};

function AvatarArtwork({ index, vip }: { index: number; vip: boolean }) {
  const [backgroundStart, backgroundEnd] = (vip ? vipBackgrounds : backgrounds)[index % (vip ? vipBackgrounds.length : backgrounds.length)];
  const skin = skinTones[index % skinTones.length];
  const hair = hairTones[(index + (vip ? 2 : 0)) % hairTones.length];
  const shirt = (vip ? vipShirtTones : shirtTones)[index % (vip ? vipShirtTones.length : shirtTones.length)];
  const hasGlasses = index % 5 === 1 || (vip && index % 7 === 0);
  const hasEarring = index % 4 === 2;

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[10px]"
      style={{ background: `linear-gradient(145deg, ${backgroundStart}, ${backgroundEnd})` }}
    >
      <div className="absolute -right-3 -top-3 h-10 w-10 rounded-full bg-white/10 blur-md" />
      {vip && (
        <div className="absolute inset-1 rounded-[8px] border border-amber-200/35" />
      )}
      <svg viewBox="0 0 64 64" className="relative h-full w-full" aria-hidden="true">
        <path d="M8 66c1-12 9-19 24-19s23 7 24 19" fill={shirt} />
        <path d="M25 42h14v10H25z" fill={skin} />
        <circle cx="17" cy="30" r="3.5" fill={skin} />
        <circle cx="47" cy="30" r="3.5" fill={skin} />
        <ellipse cx="32" cy="29" rx="15" ry="17" fill={skin} />
        <path d={hairStyles[index % hairStyles.length]} fill={hair} />
        <path d="M23 27c1.5-1 3.5-1 5 0M36 27c1.5-1 3.5-1 5 0" fill="none" stroke="#3b2730" strokeLinecap="round" strokeWidth="1.5" />
        <circle cx="26" cy="30" r="1.3" fill="#1f1720" />
        <circle cx="38" cy="30" r="1.3" fill="#1f1720" />
        <path d="M29 36c2 1.5 4 1.5 6 0" fill="none" stroke="#9a4f4e" strokeLinecap="round" strokeWidth="1.4" />
        {hasGlasses && (
          <g fill="none" stroke="#f5d38a" strokeWidth="1.2">
            <rect x="20" y="27" width="10" height="7" rx="3" />
            <rect x="34" y="27" width="10" height="7" rx="3" />
            <path d="M30 29h4" />
          </g>
        )}
        {hasEarring && <circle cx="46" cy="35" r="1.4" fill="#f6d88d" />}
        {vip && (
          <path d="M19 15l4-5 4 3 5-5 5 5 4-3 4 5" fill="none" stroke="#f7d77d" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        )}
      </svg>
      {vip && (
        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border border-amber-100/70 bg-gradient-to-br from-amber-200 to-amber-500 text-[9px] font-black text-amber-950 shadow-md shadow-amber-950/40">
          ◆
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent" />
    </div>
  );
}

export default function CustomerAvatarPicker({ value, onChange, theme, variant }: CustomerAvatarPickerProps) {
  const options = variant === 'vip' ? vipAvatarOptions : regularAvatarOptions;
  const styles = themeStyles[theme];
  const selectedOption = options.find((option) => option.emoji === value);

  return (
    <div className={`rounded-2xl border p-2.5 shadow-inner shadow-black/20 ${variant === 'vip' ? 'border-amber-300/30 bg-gradient-to-br from-amber-950/35 via-slate-950/60 to-yellow-950/20' : styles.panel}`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${variant === 'vip' ? 'text-amber-200' : styles.accent}`}>
            {variant === 'vip' ? 'Signature collection' : 'Character collection'}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">Illustrated profile avatars</p>
        </div>
        {selectedOption && (
          <span className={`max-w-[42%] truncate rounded-full border px-2 py-1 text-[9px] font-semibold ${variant === 'vip' ? 'border-amber-200/30 bg-amber-400/10 text-amber-200' : `border-white/10 bg-white/5 ${styles.accent}`}`}>
            {selectedOption.label}
          </span>
        )}
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
        {options.map((option, index) => {
          const selected = value === option.emoji;
          return (
            <button
              key={`${option.emoji}-${index}`}
              type="button"
              title={option.label}
              aria-label={`Select ${option.label} avatar`}
              aria-pressed={selected}
              onClick={() => onChange(option.emoji)}
              className={`group relative aspect-square overflow-hidden rounded-xl border p-1 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.04] focus:outline-none focus:ring-2 focus:ring-white/70 ${selected ? (variant === 'vip' ? 'border-amber-200 bg-amber-400/20 ring-2 ring-amber-300/90 shadow-lg shadow-amber-500/30' : styles.selected) : (variant === 'vip' ? 'border-amber-200/15 bg-slate-900/75 hover:border-amber-200/70 hover:bg-amber-400/10' : styles.idle)}`}
            >
              <AvatarArtwork index={index} vip={variant === 'vip'} />
              {selected && (
                <span className={`absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${variant === 'vip' ? 'bg-amber-100 shadow-[0_0_8px_rgba(253,230,138,0.95)]' : theme === 'orange' ? 'bg-orange-100 shadow-[0_0_8px_rgba(255,237,213,0.95)]' : 'bg-emerald-100 shadow-[0_0_8px_rgba(209,250,229,0.95)]'}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
