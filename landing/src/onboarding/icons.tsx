/**
 * Icons for the onboarding flow. We use lucide-react (already a project
 * dependency) for the standard glyphs, plus one custom mark: the Noto
 * wordmark.
 */
export {
  Check,
  ArrowRight,
  ArrowDown,
  CornerDownLeft,
  Command,
  SquarePen,
  Waypoints,
  Mic,
  Search,
  Link as LinkIcon,
  Keyboard,
  Moon,
  Sun,
  Sparkles,
} from "lucide-react";

/** Noto "N" wordmark — stroke uses the page background so it reads on the ink chip. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" width="14" height="14" fill="none">
      <path
        d="M9 24V8l14 16V8"
        stroke="var(--page-bg)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
