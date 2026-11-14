import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Svg>
);

export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const DashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.01" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);

export const FieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 20h18M5 20c0-5 2-9 7-11M19 20c0-5-2-9-7-11M12 9V3M9 5.5l3-2.5 3 2.5" />
  </Svg>
);

export const BarnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10l9-6 9 6v10H3z" />
    <path d="M9 20v-6h6v6M9 14l6 6M15 14l-6 6" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" />
    <path d="M4 21V5M8 7h7" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const SatelliteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 7l4 4-6 6-4-4z" />
    <path d="M6 14l-3 3 4 4 3-3M14 6l3-3 4 4-3 3" />
    <path d="M15.5 17.5a3 3 0 003-3" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
    <path d="M12 8v4M12 15.5v.01" />
  </Svg>
);

export const CloudRainIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 15a4 4 0 01-.5-7.97A5.5 5.5 0 0117 8.5a3.5 3.5 0 01.5 6.5" />
    <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
  </Svg>
);

export const LeafIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" />
    <path d="M5 19c3-4 6-7 10-9" />
  </Svg>
);

export const DropIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 01-12 0c0-3.2 2.5-6.5 6-11z" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4l9 4.5-9 4.5-9-4.5z" />
    <path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" />
  </Svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9.5h8M8 12.5h5" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </Svg>
);

/** A dashed selection with a pointer: drag to select. */
export const SelectDragIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M4 15v4a1 1 0 001 1h4" strokeDasharray="2 2.5" />
    <path d="M13 13l7 2.5-3 1.5-1.5 3z" />
  </Svg>
);

/** Same artwork as public/icons/icon.svg: a sprout under two signal arcs. */
export const LogoMark = ({ size = 28, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false" {...props}>
    <rect width="512" height="512" rx="112" fill="#24603f" />
    <g fill="none" stroke="#e3b15a" strokeWidth="26" strokeLinecap="round">
      <path d="M190 196a96 96 0 0 1 132 0" />
      <path d="M144 150a160 160 0 0 1 224 0" />
    </g>
    <path d="M256 412V262" stroke="#f6f5ef" strokeWidth="24" strokeLinecap="round" />
    <path d="M256 330c-6-56-46-86-104-84 2 56 44 88 104 84z" fill="#f6f5ef" />
    <path d="M256 300c6-56 46-86 104-84-2 56-44 88-104 84z" fill="#f6f5ef" />
  </svg>
);
