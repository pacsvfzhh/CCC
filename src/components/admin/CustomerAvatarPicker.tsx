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
  size?: 'compact' | 'large';
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

function getAvatarBackground(index: number, vip: boolean): [string, string] {
  const businessHues = [215, 220, 205, 198, 228, 170, 32, 345, 235, 190, 25, 210];
  const hue = businessHues[(index * 7 + (vip ? 3 : 0)) % businessHues.length];
  const accentHue = (hue + (index % 3 === 0 ? 28 : 12)) % 360;
  const baseLightness = vip ? 22 + (index % 3) * 3 : 25 + (index % 4) * 3;
  const accentLightness = vip ? 42 + (index % 4) * 4 : 46 + (index % 4) * 4;

  return [
    `hsl(${hue} 30% ${baseLightness}%)`,
    `hsl(${accentHue} 42% ${accentLightness}%)`,
  ];
}

const skinTones = ['#f7c9a9', '#efb38f', '#f4d0b9', '#f8d7c0', '#f1c3a5', '#e8ad8f', '#f3ccb4', '#d9916c', '#bd7655', '#f7c9a9'];
const hairTones = ['#17191c', '#241d1a', '#33251e', '#463126', '#5a3b2a', '#2d3034', '#3f3029', '#594338', '#6b4a35', '#292625'];
const shirtTones = ['#f8fafc', '#e2e8f0', '#cbd5e1', '#334155', '#1e3a5f', '#2f4858', '#4a3f35', '#6b7280', '#d6d3d1', '#1f2937'];
const vipShirtTones = ['#c6a45c', '#e4cf8b', '#9e91bd', '#b98263', '#6f9b93', '#d3b66a', '#34445f', '#6b587d', '#3f716b', '#9a7655'];
const tieTones = ['#1e3a5f', '#334155', '#3f4c6b', '#5a3d36', '#1f4b4b', '#55415f', '#7b5c3d', '#263238'];
const scarfTones = ['#9fadb8', '#b7a99b', '#7c8b8a', '#8a7f88', '#a38b72', '#6f7c89'];

const faceShapes = [
  'M18 29c0-10 6-17 14-17s14 7 14 17c0 10-6 17-14 17S18 39 18 29Z',
  'M19 26c0-9 5-14 13-14s13 5 13 14c0 8-3 17-13 19-10-2-13-11-13-19Z',
  'M17 29c0-10 7-16 15-16s15 6 15 16c0 8-5 17-15 17S17 37 17 29Z',
  'M19 24c2-8 7-12 13-12s12 4 13 12c1 10-3 21-13 22-10-1-14-12-13-22Z',
  'M18 28c0-9 5-16 14-16s14 7 14 16c0 9-4 17-14 17S18 37 18 28Z',
  'M17 27c1-10 7-15 15-15s14 5 15 15c0 10-5 18-15 18s-15-8-15-18Z',
  'M18 27c0-10 6-15 14-15s14 5 14 15c0 11-5 18-14 18S18 38 18 27Z',
  'M20 26c0-8 4-14 12-14 9 0 13 6 13 14 0 9-4 18-13 18-8 0-12-9-12-18Z',
  'M17 28c1-9 6-16 15-16 8 0 14 7 15 16-1 10-6 17-15 17-10 0-14-7-15-17Z',
  'M19 25c1-8 6-13 13-13 8 0 13 5 14 13 1 10-4 20-14 20-9 0-14-10-13-20Z',
];

const hairStyles = [
  'M15 31C13 17 20 8 32 8s19 9 17 23c-3-5-6-7-10-8-5 6-13 8-24 8Z',
  'M14 31C13 17 21 8 32 8c11 0 19 8 18 23l-5 3-2-14c-8 5-16 6-26 4l-1 12Z',
  'M15 27C16 14 23 8 33 8c11 0 17 8 17 20-3-5-6-7-8-8-4 4-11 7-24 7Z',
  'M16 29C14 16 21 7 33 7c12 0 18 9 16 23l-4-4-2-10c-7 3-15 4-25 2l-1 11Z',
  'M14 29C14 15 23 7 34 7c8 0 14 5 16 13-8-3-15-2-23 2-3 2-7 4-13 7Z',
  'M15 30C12 26 13 18 17 14c0-5 5-8 9-6 3-4 10-4 12 0 5-2 10 2 10 7 5 3 6 10 3 15-4-5-8-7-12-8-6 5-14 8-24 8Z',
  'M14 30C11 24 13 14 19 10c3-5 10-5 13-1 4-4 11-2 12 3 6 2 8 9 6 15-4-5-8-7-12-8-6 5-14 8-24 8Z',
  'M15 28c0-11 6-18 17-20 8 2 14 7 16 16-5-2-10-3-15-1-5 2-10 4-18 5Z',
  'M15 31C13 17 19 8 31 8c12 0 20 9 18 23l-5 2-3-12-3 6-5-7-4 7-6-4-2 11Z',
  'M15 29C14 17 22 9 32 8c10 0 18 7 18 19-4-2-7-6-8-11-6 4-14 7-27 7Z',
];

const femaleBackHairStyles = [
  'M13 49C10 37 11 19 19 10 26 3 39 4 47 12c7 8 8 23 3 37l-8-3-2-19c-6 4-13 5-20 2l-1 20Z',
  'M12 48C9 34 12 17 21 9c7-6 19-6 27 2 7 8 7 23 4 37l-8-3-1-18c-6 3-14 4-22 1l-2 20Z',
  'M14 50C10 36 12 19 20 11 27 4 39 4 47 11c8 8 8 23 4 39l-7-4-2-20c-6 4-13 5-20 2l-1 22Z',
  'M12 47C10 32 14 16 23 9c8-6 19-4 26 4 6 8 6 21 3 35l-8-3-1-18c-6 3-13 4-21 1l-2 19Z',
  'M11 48C9 35 12 18 22 9c8-7 20-5 27 4 6 8 6 23 2 37l-8-4-2-21c-6 4-13 5-21 2l-1 21Z',
  'M14 50C9 39 10 20 18 11c7-8 20-8 28 0 8 9 9 27 4 40l-8-4-2-21c-5 4-13 6-22 2l-1 22Z',
  'M12 49C8 38 10 20 19 10c7-8 20-9 28-2 7 7 9 20 5 39l-8-4-2-20c-6 4-13 5-21 2l-1 24Z',
  'M11 47C7 36 10 18 20 9c8-7 21-6 29 3 6 8 7 22 3 37l-9-4-1-20c-6 4-14 5-22 2l-1 20Z',
  'M12 47C8 41 10 31 12 25c-2-8 4-16 11-15 4-7 14-8 19-2 8 0 13 8 10 15 5 7 4 17 0 25l-8-3-2-20c-6 4-13 5-21 2l-1 20Z',
  'M16 50C12 37 13 18 21 10c-2-6 3-10 9-8 3-5 11-5 14 0 6-1 10 4 8 9 6 10 5 27 1 39l-8-4-2-20c-6 4-13 5-21 2l-1 22Z',
];

const femaleHairStyles = [
  'M15 27C16 14 23 8 33 8c11 0 18 8 17 19-4-4-7-7-9-12-6 5-14 8-26 7Z',
  'M14 29C14 16 22 8 33 8c10 0 17 7 18 19-5-3-8-7-10-12-6 5-14 8-27 7Z',
  'M15 26C17 14 24 8 33 8c10 0 17 7 17 19-4-3-7-7-9-12-5 5-14 8-26 7Z',
  'M16 28C15 15 22 7 33 7c11 0 18 8 16 21-4-4-7-8-9-13-6 5-13 8-24 8Z',
  'M14 28C15 15 23 7 33 7c10 0 17 7 18 20-5-4-8-8-10-14-6 5-14 8-27 8Z',
  'M15 29C15 16 21 8 32 8c11 0 18 8 18 20-4-3-8-7-10-12-6 5-14 8-25 7Z',
  'M14 29C14 16 21 8 32 8c10 0 18 8 18 21-5-5-8-8-10-13-5 6-14 8-26 7Z',
  'M15 28C16 14 24 7 34 8c8 1 15 7 16 16-5-3-9-7-12-13-5 5-12 8-23 8Z',
  'M14 28C14 15 23 7 33 7c11 0 17 8 17 21-3-6-7-10-11-13-3 5-13 10-25 10Z',
  'M15 29C15 16 21 8 32 8c11 0 18 8 18 20-4-3-8-7-10-12-6 5-14 8-25 7Z',
];

const mouthStyles = [
  'M29 36c2 1.5 4 1.5 6 0',
  'M28 36c2 2 6 2 8 0',
  'M29 36c2 1 4 1 6 0',
  'M28 35c2 2 6 2 8 0',
];

const bodyStyles = [
  'M7 66c2-12 10-19 25-19s23 7 25 19',
  'M3 66c4-14 13-20 29-20s25 6 29 20',
  'M10 66c0-11 8-18 22-18s22 7 22 18',
  'M5 66c3-9 11-17 27-17s24 8 27 17',
  'M8 66c4-15 12-21 24-21s20 6 24 21',
  'M1 66c4-11 14-18 31-18s27 7 31 18',
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
  const featureSeed = index * 7 + (vip ? 29 : 11);
  const [backgroundStart, backgroundEnd] = getAvatarBackground(index, vip);
  const skin = skinTones[(featureSeed * 7 + 2) % skinTones.length];
  const hair = hairTones[(featureSeed * 11 + (vip ? 2 : 0)) % hairTones.length];
  const isFemale = index % 2 === 0;
  const hairOptions = isFemale ? femaleHairStyles : hairStyles;
  const hairStyle = hairOptions[(featureSeed * 3 + 1) % hairOptions.length];
  const faceShape = faceShapes[(featureSeed * 5 + (vip ? 1 : 0)) % faceShapes.length];
  const shirtPalette = vip ? vipShirtTones : shirtTones;
  const shirt = shirtPalette[(featureSeed * 13 + 4) % shirtPalette.length];
  const eyeVariant = (featureSeed * 5) % 4;
  const browVariant = (featureSeed * 3) % 3;
  const noseVariant = (featureSeed * 11) % 3;
  const hasGlasses = featureSeed % 8 === 1 || (vip && featureSeed % 9 === 0);
  const hasEarring = featureSeed % 5 === 2 || (isFemale && featureSeed % 8 === 0);
  const hasHairHighlight = featureSeed % 4 === 0;
  const hasNecklace = isFemale && featureSeed % 5 === 2;
  const hasCollar = featureSeed % 3 === 1 || (vip && featureSeed % 5 === 0);
  const hasTie = !isFemale && featureSeed % 5 === 3;
  const hasScarf = isFemale && featureSeed % 9 === 4;
  const hasFacialHair = !isFemale && featureSeed % 6 === 1;
  const hasFreckles = featureSeed % 11 === 3;
  const mouthStyle = mouthStyles[(featureSeed * 7 + 2) % mouthStyles.length];
  const bodyStyle = bodyStyles[(featureSeed * 13 + 1) % bodyStyles.length];
  const tie = tieTones[(featureSeed * 5 + 1) % tieTones.length];
  const scarf = scarfTones[(featureSeed * 3 + 2) % scarfTones.length];
  const earringColor = ['#bda66b', '#9fb6ad', '#b88c9c', '#9aaec2'][featureSeed % 4];
  const backgroundStyle = featureSeed % 6;
  const ageDetail = featureSeed % 5;
  const portraitTilt = [-4, -2, 0, 2, 4][featureSeed % 5];
  const portraitShift = [-1.5, -0.75, 0, 0.75, 1.5][(featureSeed * 3) % 5];

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[10px] ${vip ? 'scale-[1.1]' : ''}`}
      style={{ background: `linear-gradient(145deg, ${backgroundStart} 0%, ${backgroundEnd} 100%)` }}
    >
      {backgroundStyle === 0 && <div className="absolute -right-3 -top-3 h-10 w-10 rounded-full bg-white/25 blur-md" />}
      {backgroundStyle === 1 && <div className="absolute -left-3 -top-2 h-8 w-8 rotate-12 rounded-full bg-white/25 blur-md" />}
      {backgroundStyle === 2 && <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />}
      {backgroundStyle === 3 && <div className="absolute -bottom-4 -right-2 h-10 w-10 rounded-full bg-black/20 blur-md" />}
      {backgroundStyle === 4 && <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-white/18 to-transparent" />}
      {backgroundStyle === 5 && <div className="absolute bottom-1 right-1 h-3 w-3 rounded-full bg-white/40 shadow-[0_0_12px_rgba(255,255,255,.6)]" />}
      {vip && <div className="absolute inset-1 rounded-[8px] border border-amber-100/55" />}
      <svg viewBox="0 0 64 64" className="relative h-full w-full" aria-hidden="true">
        <g transform={`translate(${portraitShift} 0) rotate(${portraitTilt} 32 34)`}>
        <path d={bodyStyle} fill={shirt} />
        {hasCollar && <path d="M20 52l12 8 12-8 4 14H16z" fill={vip ? '#fff0b0' : '#ffffff'} opacity=".8" />}
        <path d="M24 44h16v10H24z" fill={skin} />
        <path d="M25 48l7 7 7-7 4 4-4 14H25l-4-14z" fill={vip ? '#fff0b0' : '#ffffff'} opacity=".72" />
        {hasTie && (
          <>
            <path d="M29 51h6l2 15H27z" fill={tie} />
            <path d="M29 51l3 4 3-4" fill="none" stroke="#e8dcc3" strokeWidth="1" />
          </>
        )}
        {hasScarf && <path d="M21 50c4 4 18 4 22 0l-2 7c-5 2-13 2-18 0Z" fill={scarf} opacity=".9" />}
        {isFemale && <path d={femaleBackHairStyles[(featureSeed * 17) % femaleBackHairStyles.length]} fill={hair} />}
        <circle cx="17" cy="30" r="3.5" fill={skin} />
        <circle cx="47" cy="30" r="3.5" fill={skin} />
        <path d={faceShape} fill={skin} />
        <path d={hairStyle} fill={hair} />
        {browVariant === 0 && <path d="M22 26c2-1.5 4-1.5 6-.2M36 25.8c2-1.3 4-1.3 6 .2" fill="none" stroke="#3b2730" strokeLinecap="round" strokeWidth="1.5" />}
        {browVariant === 1 && <path d="M22 25.5c2-1 4-1 6 .4M36 25.9c2-1.4 4-1.4 6-.4" fill="none" stroke="#3b2730" strokeLinecap="round" strokeWidth="1.5" />}
        {browVariant === 2 && <path d="M22 26.2c2-.4 4-.4 6 .5M36 26.7c2-.9 4-.9 6-.5" fill="none" stroke="#3b2730" strokeLinecap="round" strokeWidth="1.5" />}
        {eyeVariant === 0 && (
          <>
            <circle cx="26" cy="30" r="1.3" fill="#1f1720" />
            <circle cx="38" cy="30" r="1.3" fill="#1f1720" />
          </>
        )}
        {eyeVariant === 1 && (
          <>
            <ellipse cx="26" cy="30" rx="1.8" ry="1.1" fill="#1f1720" />
            <ellipse cx="38" cy="30" rx="1.8" ry="1.1" fill="#1f1720" />
          </>
        )}
        {eyeVariant === 2 && (
          <>
            <path d="M24.5 30c.8-1.4 2.2-1.4 3 0M36.5 30c.8-1.4 2.2-1.4 3 0" fill="none" stroke="#1f1720" strokeLinecap="round" strokeWidth="1.5" />
            <circle cx="26" cy="30" r=".65" fill="#1f1720" />
            <circle cx="38" cy="30" r=".65" fill="#1f1720" />
          </>
        )}
        {eyeVariant === 3 && (
          <>
            <ellipse cx="26" cy="30" rx="1.45" ry="1.25" fill="#1f1720" />
            <ellipse cx="38" cy="30" rx="1.45" ry="1.25" fill="#1f1720" />
            <circle cx="25.65" cy="29.65" r=".35" fill="#fff" />
            <circle cx="37.65" cy="29.65" r=".35" fill="#fff" />
          </>
        )}
        {noseVariant === 0 && <path d="M32 30.5v3l-1.5 1" fill="none" stroke="#b87563" strokeLinecap="round" strokeWidth="1" />}
        {noseVariant === 1 && <path d="M31 30l-.5 4 2 1" fill="none" stroke="#b87563" strokeLinecap="round" strokeWidth="1" />}
        {noseVariant === 2 && <path d="M32 30.5v3.2" fill="none" stroke="#b87563" strokeLinecap="round" strokeWidth="1" />}
        {ageDetail !== 4 && <path d="M23 34c-1.5 1-2.5 2-3 3M41 34c1.5 1 2.5 2 3 3" fill="none" stroke="#a96f61" strokeLinecap="round" strokeWidth=".85" opacity=".58" />}
        {ageDetail === 0 && <path d="M25 19c2-1 4-1 6-.5M33 18.5c2-.5 4-.5 6 .5" fill="none" stroke="#a96f61" strokeLinecap="round" strokeWidth=".8" opacity=".5" />}
        {ageDetail === 1 && <path d="M23 32c-1.5 1-2 2-2.5 3M41 32c1.5 1 2 2 2.5 3" fill="none" stroke="#a96f61" strokeLinecap="round" strokeWidth=".8" opacity=".55" />}
        {ageDetail === 2 && <path d="M24 35c-1.5 1-2 2-2.5 3M40 35c1.5 1 2 2 2.5 3" fill="none" stroke="#a96f61" strokeLinecap="round" strokeWidth=".8" opacity=".52" />}
        <path d={mouthStyle} fill="none" stroke={isFemale ? '#a55567' : '#885048'} strokeLinecap="round" strokeWidth="1.4" />
        {hasFreckles && (
          <>
            <circle cx="23" cy="35" r=".8" fill="#a9654c" opacity=".7" />
            <circle cx="25.5" cy="36" r=".7" fill="#a9654c" opacity=".7" />
            <circle cx="39" cy="36" r=".7" fill="#a9654c" opacity=".7" />
            <circle cx="41" cy="35" r=".8" fill="#a9654c" opacity=".7" />
          </>
        )}
        {hasFacialHair && <path d="M25 37c1 5 4 7 7 7s6-2 7-7c-3 1.5-11 1.5-14 0Z" fill={hair} opacity=".58" />}
        {!isFemale && featureSeed % 5 === 2 && <path d="M27 36c1.5 1 8.5 1 10 0" fill="none" stroke={hair} strokeLinecap="round" strokeWidth="1.8" opacity=".75" />}
        {hasHairHighlight && <path d="M20 17c3-4 7-6 12-7" fill="none" stroke="#d9cdbd" strokeLinecap="round" strokeWidth="1.2" opacity=".5" />}
        {hasNecklace && (
          <>
            <path d="M24 47c3 4 13 4 16 0" fill="none" stroke="#f8d978" strokeLinecap="round" strokeWidth="1.1" />
            <circle cx="32" cy="51" r="1.8" fill="#f8d978" />
          </>
        )}
        {hasGlasses && (
          <g fill="none" stroke={vip ? '#fff0a5' : '#ffffff'} strokeWidth="1.2">
            <rect x="20" y="27" width="10" height="7" rx="3" />
            <rect x="34" y="27" width="10" height="7" rx="3" />
            <path d="M30 29h4" />
          </g>
        )}
        {hasEarring && (
          <>
            <circle cx="18" cy="35" r="1.4" fill={earringColor} />
            <circle cx="46" cy="35" r="1.4" fill={earringColor} />
          </>
        )}
        </g>
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

export default function CustomerAvatarPicker({ value, onChange, theme, variant, size = 'compact' }: CustomerAvatarPickerProps) {
  const collection: AvatarCollection = variant === 'vip' ? 'vip' : 'regular';
  const options = collection === 'vip' ? vipAvatarOptions : regularAvatarOptions;
  const styles = themeStyles[theme];
  const selectedIndex = getAvatarIndex(value, collection);
  const isStoredAvatarKey = value?.startsWith('customer-avatar:') ?? false;

  return (
    <div className={`rounded-2xl border shadow-inner shadow-black/25 ${size === 'large' ? 'p-1.5' : 'p-2.5'} ${variant === 'vip' ? 'border-amber-200/45 bg-gradient-to-br from-amber-950/50 via-slate-950/70 to-yellow-950/30' : styles.panel}`}>
      <div className={`grid ${size === 'large' ? 'grid-cols-6 gap-1 sm:grid-cols-8' : 'gap-1'} ${variant === 'vip' ? 'grid-cols-6' : size === 'large' ? '' : 'grid-cols-8 sm:grid-cols-10'}`}>
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
