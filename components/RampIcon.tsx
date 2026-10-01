import type { ReactNode } from "react";

export type RampIconName =
  | "search" | "inbox" | "chart" | "card" | "coin" | "briefcase" | "cart"
  | "book" | "building" | "store" | "settings" | "bell" | "user" | "moon"
  | "columns" | "plus" | "filter" | "calendar" | "trash" | "chevron" | "close"
  | "spark" | "clock" | "check" | "menu" | "refresh" | "download" | "arrow";

const paths: Record<RampIconName, ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.4 15.4 4.1 4.1" /></>,
  inbox: <><path d="m4 6-2 9v4h20v-4l-2-9Z" /><path d="M2 15h6l2 3h4l2-3h6M7 6h10" /></>,
  chart: <><path d="M4 20V9h4v11M10 20V4h4v16M16 20v-8h4v8M3 20h18" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 10h18M7 15h4" /></>,
  coin: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.8-.8-1.6-1-3-1-1.7 0-3 1-3 2.4 0 3.2 6 1 6 4.2 0 1.4-1.4 2.4-3 2.4-1.4 0-2.4-.4-3.3-1.2M12 5.5v13" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V4h8v3M3 12a23 23 0 0 0 18 0M10 12h4v3h-4Z" /></>,
  cart: <><path d="M2 4h3l2.2 11h11.3l2-8H6M8 18h10" /><circle cx="8" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
  book: <><path d="M4 3h14a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2ZM4 17h16M8 7h8M8 11h6" /></>,
  building: <><path d="M4 21V3h16v18M2 21h20M9 21v-5h6v5M8 7h1M15 7h1M8 11h1M15 11h1" /></>,
  store: <><path d="M4 10v11h16V10M2 10l2-6h16l2 6M2 10a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M9 21v-7h6v7" /></>,
  settings: <><path d="m9 3-.5 2-2 .9-1.9-.6-2 3.4 1.4 1.4v2.3l-1.4 1.4 2 3.4 1.9-.6 2 .9.5 2h4l.5-2 2-.9 1.9.6 2-3.4-1.4-1.4v-2.3l1.4-1.4-2-3.4-1.9.6-2-.9-.5-2Z" /><circle cx="11" cy="11" r="3" /></>,
  bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4M12 2v2" /></>,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  moon: <path d="M20.5 14.2A9.4 9.4 0 0 1 9.8 3.5 9.4 9.4 0 1 0 20.5 14.2Z" />,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M3 4h18l-7 8v7l-4 2v-9Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h2M7 17h2" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  chevron: <path d="m8 10 4 4 4-4" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  spark: <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z" /><path d="M21 2v4M19 4h4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M5.5 7a8 8 0 0 1 13-1L20 8M4 16l1.5 2a8 8 0 0 0 13-1" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
};

export default function RampIcon({ name, size = 16, className }: {
  name: RampIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
