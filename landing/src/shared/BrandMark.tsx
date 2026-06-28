// The Noto "N" mark — one brand glyph shared across surfaces (nav, onboarding,
// favicon) instead of the old lucide cube on the landing vs. the "N" elsewhere.
// Uses currentColor so the containing chip controls the color.
export function BrandMark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M9 24V8l14 16V8"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
