interface DispatchShipProps {
  idPrefix: string;
  className?: string;
  viewBox?: string;
}

export default function DispatchShip({ idPrefix, className = '', viewBox = '80 40 720 230' }: DispatchShipProps) {
  const hull = `${idPrefix}-hull`;
  const cabin = `${idPrefix}-cabin`;
  return (
    <svg className={className} viewBox={viewBox} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={hull} x1="93" y1="160" x2="781" y2="263" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="0.55" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e40af" />
        </linearGradient>
        <linearGradient id={cabin} x1="176" y1="54" x2="420" y2="162" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path d="M93 180h640l48-18-35 65c-12 26-35 36-68 36H196c-52 0-80-14-92-40L93 180Z" fill={`url(#${hull})`} fillOpacity="0.55" />
      <path d="M102 164h632l-2 17H94l8-17Z" fill="#0891b2" fillOpacity="0.4" />
      <path d="M176 161v-46c0-7 6-13 13-13h147c7 0 13 6 13 13v46H176Z" fill={`url(#${cabin})`} fillOpacity="0.5" />
      <path d="M204 102V80c0-7 6-13 13-13h97c7 0 13 6 13 13v22H204Z" fill={`url(#${cabin})`} fillOpacity="0.45" />
      <path d="M223 67V54h85v13h-85ZM377 162v-53h44v53h-44Z" fill="#60a5fa" fillOpacity="0.45" />
      <path d="M386 109V88h26v21h-26Z" fill="#7dd3fc" fillOpacity="0.55" />
      <path d="M445 161v-29h188l24 29H445Z" fill="#3b82f6" fillOpacity="0.4" />
      <path d="M482 132V71m-17 61 17-41 18 41" stroke="#2563eb" strokeOpacity="0.45" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M222 85h18m17 0h18m17 0h18M199 125h22m17 0h22m17 0h22m17 0h15" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
