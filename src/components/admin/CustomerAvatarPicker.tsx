import { useState } from 'react';

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

const regularBackgrounds = [
  ['#24558d', '#6ed0d2'],
  ['#493b99', '#d86b9f'],
  ['#1d746e', '#a7d998'],
  ['#a15738', '#f2bd7e'],
  ['#9e3f61', '#e58ea8'],
  ['#355c95', '#aa8be4'],
];

const vipBackgrounds = [
  ['#34206d', '#e5a53e'],
  ['#173d67', '#d7923b'],
  ['#563078', '#db6c91'],
  ['#155b5d', '#e5bf5d'],
  ['#712c4b', '#e08b45'],
  ['#314579', '#6dd1c0'],
];

const skinTones = ['#f7c9a9', '#efb38f', '#d9916c', '#bd7655', '#985b45', '#f4d0b9'];
const hairTones = ['#211923', '#41271e', '#75452a', '#bd7038', '#edbb62', '#51436f'];
const shirtTones = ['#edf4ff', '#ffe7f0', '#e5fff7', '#fff0d4', '#f0e9ff', '#e1f5ff'];
const vipShirtTones = ['#f3d18a', '#ffe5a3', '#cab8ff', '#f3a5b9', '#9de5dc', '#fff0bd'];

const hairStyles = [
  'M15 31C13 17 20 8 32 8s19 9 17 23c-3-5-6-7-10-8-5 6-13 8-24 8Z',
  'M14 31C13 17 21 8 32 8c11 0 19 8 18 23l-5 3-2-14c-8 5-16 6-26 4l-1 12Z',
  'M15 27C16 14 23 8 33 8c11 0 17 8 17 20-3-5-6-7-8-8-4 4-11 7-24 7Z',
  'M16 29C14 16 21 7 33 7c12 0 18 9 16 23l-4-4-2-10c-7 3-15 4-25 2l-1 11Z',
];

const femaleBackHairStyles = [
  'M13 49C10 37 11 19 19 10 26 3 39 4 47 12c7 8 8 23 3 37l-8-3-2-19c-6 4-13 5-20 2l-1 20Z',
  'M12 48C9 34 12 17 21 9c7-6 19-6 27 2 7 8 7 23 4 37l-8-3-1-18c-6 3-14 4-22 1l-2 20Z',
  'M14 50C10 36 12 19 20 11 27 4 39 4 47 11c8 8 8 23 4 39l-7-4-2-20c-6 4-13 5-20 2l-1 22Z',
  'M12 47C10 32 14 16 23 9c8-6 19-4 26 4 6 8 6 21 3 35l-8-3-1-18c-6 3-13 4-21 1l-2 19Z',
];

const femaleHairStyles = [
  'M15 27C16 14 23 8 33 8c11 0 18 8 17 19-4-4-7-7-9-12-6 5-14 8-26 7Z',
  'M14 29C14 16 22 8 33 8c10 0 17 7 18 19-5-3-8-7-10-12-6 5-14 8-27 7Z',
  'M15 26C17 14 24 8 33 8c10 0 17 7 17 19-4-3-7-7-9-12-5 5-14 8-26 7Z',
  'M16 28C15 15 22 7 33 7c11 0 18 8 16 21-4-4-7-8-9-13-6 5-13 8-24 8Z',
];

const themeStyles: Record<CustomerAvatarPickerTheme, {
  panel: string;
  idle: string;
  selected: string;
  accent: string;
}> = {
  orange: {
    panel: 'border-orange-300/25 bg-gradient-to-br from-orange-950/30 via-slate-950/60 to-amber-950/20',
    idle: 'border-orange-200/20 bg-slate-950/65 hover:border-orange-200/80 hover:bg-orange-400/10',
    selected: 'border-orange-200 bg-orange-400/20 ring-2 ring-orange-300/90 shadow-lg shadow-orange-500/30',
    accent: 'text-orange-100',
  },
  emerald: {
    panel: 'border-emerald-300/25 bg-gradient-to-br from-emerald-950/30 via-slate-950/60 to-teal-950/20',
    idle: 'border-emerald-200/20 bg-slate-950/65 hover:border-emerald-200/80 hover:bg-emerald-400/10',
    selected: 'border-emerald-200 bg-emerald-400/20 ring-2 ring-emerald-300/90 shadow-lg shadow-emerald-500/30',
    accent: 'text-emerald-100',
  },
};

function AvatarArtwork({ index, vip }: { index: number; vip: boolean }) {
  const palette = vip ? vipBackgrounds : regularBackgrounds;
  const [backgroundStart, backgroundEnd] = palette[index % palette.length];
  const skin = skinTones[index % skinTones.length];
  const hair = hairTones[(index + (vip ? 2 : 0)) % hairTones.length];
  const isFemale = index % 2 === 0;
  const hairStyle = (isFemale ? femaleHairStyles : hairStyles)[index % hairStyles.length];
  const shirtPalette = vip ? vipShirtTones : shirtTones;
  const shirt = shirtPalette[index % shirtPalette.length];
  const hasGlasses = index % 5 === 1 || (vip && index % 7 === 0);
  const hasEarring = index % 4 === 2 || (isFemale && index % 5 === 0);

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[10px] ${vip ? 'scale-[1.1]' : ''}`}
      style={{ background: `linear-gradient(145deg, ${backgroundStart} 0%, ${backgroundEnd} 100%)` }}
    >
      <div className="absolute -right-3 -top-3 h-10 w-10 rounded-full bg-white/25 blur-md" />
      <div className="absolute -bottom-5 -left-3 h-9 w-9 rounded-full bg-white/15 blur-lg" />
      {vip && <div className="absolute inset-1 rounded-[8px] border border-amber-100/55" />}
      <svg viewBox="0 0 64 64" className="relative h-full w-full" aria-hidden="true">
        <path d="M7 66c2-12 10-19 25-19s23 7 25 19" fill={shirt} />
        <path d="M24 44h16v10H24z" fill={skin} />
        <path d="M25 48l7 7 7-7 4 4-4 14H25l-4-14z" fill={vip ? '#fff0b0' : '#ffffff'} opacity=".72" />
        {isFemale && <path d={femaleBackHairStyles[index % femaleBackHairStyles.length]} fill={hair} />}
        <circle cx="17" cy="30" r="3.5" fill={skin} />
        <circle cx="47" cy="30" r="3.5" fill={skin} />
        <ellipse cx="32" cy="29" rx="15" ry="17" fill={skin} />
        <path d={hairStyle} fill={hair} />
        <path d="M23 27c1.5-1 3.5-1 5 0M36 27c1.5-1 3.5-1 5 0" fill="none" stroke="#3b2730" strokeLinecap="round" strokeWidth="1.5" />
        <circle cx="26" cy="30" r="1.3" fill="#1f1720" />
        <circle cx="38" cy="30" r="1.3" fill="#1f1720" />
        {isFemale && (
          <>
            <circle cx="22" cy="35" r="2.2" fill="#ee8694" opacity=".22" />
            <circle cx="42" cy="35" r="2.2" fill="#ee8694" opacity=".22" />
          </>
        )}
        <path d="M29 36c2 1.5 4 1.5 6 0" fill="none" stroke={isFemale ? '#b64f6b' : '#9a4f4e'} strokeLinecap="round" strokeWidth="1.4" />
        {hasGlasses && (
          <g fill="none" stroke={vip ? '#fff0a5' : '#ffffff'} strokeWidth="1.2">
            <rect x="20" y="27" width="10" height="7" rx="3" />
            <rect x="34" y="27" width="10" height="7" rx="3" />
            <path d="M30 29h4" />
          </g>
        )}
        {hasEarring && <circle cx="46" cy="35" r="1.4" fill="#ffe18a" />}
        {vip && (
          <path d="M19 15l4-5 4 3 5-5 5 5 4-3 4 5" fill="#f8d978" fillOpacity=".28" stroke="#fff0a5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-950/35 to-transparent" />
    </div>
  );
}

export interface CustomerAvatarDisplayProps {
  avatar?: string | null;
  isVip?: boolean;
  customAvatarUrl?: string | null;
  alt?: string;
  className?: string;
}

const avatarKeyPattern = /^customer-avatar:(regular|vip):(\d+)$/;

type AvatarCollection = 'regular' | 'vip';

function getAvatarKey(collection: AvatarCollection, index: number) {
  return `customer-avatar:${collection}:${index}`;
}

function getAvatarIndex(avatar: string | null | undefined, collection: AvatarCollection) {
  const match = avatar?.match(avatarKeyPattern);
  if (match && match[1] === collection) {
    const index = Number(match[2]);
    const options = collection === 'vip' ? vipAvatarOptions : regularAvatarOptions;
    if (index >= 0 && index < options.length) return index;
  }

  const preferredOptions = collection === 'vip' ? vipAvatarOptions : regularAvatarOptions;
  const preferredIndex = preferredOptions.findIndex((option) => option.emoji === avatar);
  if (preferredIndex >= 0) return preferredIndex;

  const fallbackIndex = regularAvatarOptions.findIndex((option) => option.emoji === avatar);
  return fallbackIndex >= 0 ? fallbackIndex : 0;
}

export function CustomerAvatarDisplay({
  avatar,
  isVip = false,
  customAvatarUrl,
  alt = 'Customer avatar',
  className = 'h-10 w-10 rounded-full',
}: CustomerAvatarDisplayProps) {
  const [imageError, setImageError] = useState(false);
  const avatarIndex = getAvatarIndex(avatar, isVip ? 'vip' : 'regular');

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
      {customAvatarUrl && !imageError ? (
        <img
          src={customAvatarUrl}
          alt={alt}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImageError(true)}
        />
      ) : (
        <AvatarArtwork index={avatarIndex} vip={isVip} />
      )}
    </div>
  );
}

export default function CustomerAvatarPicker({ value, onChange, theme, variant }: CustomerAvatarPickerProps) {
  const collection: AvatarCollection = variant === 'vip' ? 'vip' : 'regular';
  const options = collection === 'vip' ? vipAvatarOptions : regularAvatarOptions;
  const styles = themeStyles[theme];
  const selectedIndex = getAvatarIndex(value, collection);
  const selectedOption = options[selectedIndex];
  const isStoredAvatarKey = value?.startsWith('customer-avatar:') ?? false;

  return (
    <div className={`rounded-2xl border p-2.5 shadow-inner shadow-black/25 ${variant === 'vip' ? 'border-amber-200/45 bg-gradient-to-br from-amber-950/50 via-slate-950/70 to-yellow-950/30' : styles.panel}`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${variant === 'vip' ? 'text-amber-100' : styles.accent}`}>
            {variant === 'vip' ? 'Signature collection' : 'Character collection'}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">Premium illustrated portraits</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold ${variant === 'vip' ? 'border-amber-100/35 bg-amber-300/15 text-amber-100' : `border-white/15 bg-white/10 ${styles.accent}`}`}>
          {selectedOption?.label || (variant === 'vip' ? 'Choose VIP' : 'Choose one')}
        </span>
      </div>
      <div className={`grid gap-1 ${variant === 'vip' ? 'grid-cols-6' : 'grid-cols-8 sm:grid-cols-10'}`}>
        {options.map((option, index) => {
          const optionValue = getAvatarKey(collection, index);
          const selected = value === optionValue || (!isStoredAvatarKey && selectedIndex === index);
          return (
            <button
              key={`${variant}-${option.emoji}-${index}`}
              type="button"
              title={option.label}
              aria-label={`Select ${option.label} avatar`}
              aria-pressed={selected}
              onClick={() => onChange(optionValue)}
              className={`group relative aspect-square min-w-0 overflow-hidden rounded-xl border p-0.5 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.05] focus:outline-none focus:ring-2 focus:ring-white/80 ${selected ? (variant === 'vip' ? 'border-amber-100 bg-amber-300/25 ring-2 ring-amber-200/95 shadow-lg shadow-amber-400/35' : styles.selected) : (variant === 'vip' ? 'border-amber-100/25 bg-slate-950/80 hover:border-amber-100/90 hover:bg-amber-300/15' : styles.idle)}`}
            >
              <AvatarArtwork index={index} vip={variant === 'vip'} />
              {selected && variant !== 'vip' && (
                <span className={`absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${theme === 'orange' ? 'bg-orange-50 shadow-[0_0_9px_rgba(255,237,213,1)]' : 'bg-emerald-50 shadow-[0_0_9px_rgba(209,250,229,1)]'}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
