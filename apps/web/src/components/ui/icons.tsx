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
