// Icon set for the redesigned workspace.
//
// Ported verbatim from the Claude Design handoff's `ic()` specs so the glyphs
// match the mockup exactly, plus a few extras the real app needs (delete,
// overflow, theme, settings).

type Spec = [string, Record<string, string | number>][];

const ICONS: Record<string, Spec> = {
  search: [["circle", { cx: 11, cy: 11, r: 7 }], ["path", { d: "M21 21l-4-4" }]],
  pen: [["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" }]],
  home: [["path", { d: "M3 11l9-7 9 7" }], ["path", { d: "M5 10v10h14V10" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 8 }], ["path", { d: "M12 7.5V12l3.5 2" }]],
  pin: [["path", { d: "M12 13v8" }], ["circle", { cx: 12, cy: 8, r: 4 }]],
  folder: [["path", { d: "M3 8a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }]],
  file: [["path", { d: "M7 3h7l4 4v14H7z" }], ["path", { d: "M14 3v4h4" }]],
  graph: [
    ["circle", { cx: 6, cy: 18, r: 2.4 }],
    ["circle", { cx: 18, cy: 18, r: 2.4 }],
    ["circle", { cx: 12, cy: 6, r: 2.4 }],
    ["path", { d: "M11 8l-4 8" }],
    ["path", { d: "M13 8l4 8" }],
    ["path", { d: "M8.4 18h7.2" }],
  ],
  panel: [["rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ["path", { d: "M15 5v14" }]],
  spark: [
    ["path", { d: "M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" }],
    ["path", { d: "M18.5 14l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" }],
  ],
  split: [["rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ["path", { d: "M12 5v14" }]],
  close: [["path", { d: "M6 6l12 12" }], ["path", { d: "M18 6L6 18" }]],
  mic: [["rect", { x: 9, y: 3, width: 6, height: 11, rx: 3 }], ["path", { d: "M5 11a7 7 0 0 0 14 0" }], ["path", { d: "M12 18v3" }]],
  stop: [["rect", { x: 7, y: 7, width: 10, height: 10, rx: 2.5 }]],
  send: [["path", { d: "M12 20V5" }], ["path", { d: "M6 11l6-6 6 6" }]],
  plus: [["path", { d: "M12 5v14" }], ["path", { d: "M5 12h14" }]],
  chevron: [["path", { d: "M9 6l6 6-6 6" }]],
  link: [
    ["path", { d: "M9 15l6-6" }],
    ["path", { d: "M10.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" }],
    ["path", { d: "M13.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" }],
  ],
  cards: [["rect", { x: 4, y: 6, width: 13, height: 13, rx: 2 }], ["path", { d: "M8 4h9a2 2 0 0 1 2 2v9" }]],
  list: [
    ["path", { d: "M8 6h12" }], ["path", { d: "M8 12h12" }], ["path", { d: "M8 18h12" }],
    ["path", { d: "M4 6h.01" }], ["path", { d: "M4 12h.01" }], ["path", { d: "M4 18h.01" }],
  ],
  trash: [["path", { d: "M4 7h16" }], ["path", { d: "M9 7V4h6v3" }], ["path", { d: "M6 7l1 13h11l1-13" }]],
  more: [["circle", { cx: 5, cy: 12, r: 1.3 }], ["circle", { cx: 12, cy: 12, r: 1.3 }], ["circle", { cx: 19, cy: 12, r: 1.3 }]],
  moon: [["path", { d: "M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" }]],
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ["path", { d: "M12 2v2" }], ["path", { d: "M12 20v2" }], ["path", { d: "M4 12H2" }], ["path", { d: "M22 12h-2" }],
    ["path", { d: "M5 5l1.5 1.5" }], ["path", { d: "M17.5 17.5L19 19" }], ["path", { d: "M19 5l-1.5 1.5" }], ["path", { d: "M6.5 17.5L5 19" }],
  ],
  settings: [
    ["circle", { cx: 12, cy: 12, r: 3 }],
    ["path", { d: "M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.6h-4l-.3 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z" }],
  ],
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
  stroke = 1.7,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
}) {
  const specs = ICONS[name] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {specs.map(([tag, attrs], i) => {
        if (tag === "circle") return <circle key={i} {...attrs} />;
        if (tag === "rect") return <rect key={i} {...attrs} />;
        return <path key={i} {...attrs} />;
      })}
    </svg>
  );
}
