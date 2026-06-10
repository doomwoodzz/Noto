/**
 * Icons for the onboarding flow. We use lucide-react (already a project
 * dependency) for the standard glyphs, plus two custom marks: the multi-colour
 * Google "G" and the Noto wordmark.
 */
export {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Check,
  ArrowRight,
  ArrowLeft,
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

export function GoogleG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.3 0 6.3 1.1 8.6 3.4l6.4-6.4C35 2.7 29.9.5 24 .5 14.6.5 6.4 6 2.5 14l7.5 5.8C11.8 13.4 17.4 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.2-3.2-.5-4.7H24v9.3h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.8-9.9 6.8-17.5z" />
      <path fill="#FBBC05" d="M10 28.3a14.6 14.6 0 0 1 0-8.6l-7.5-5.8a24 24 0 0 0 0 20.2l7.5-5.8z" />
      <path fill="#34A853" d="M24 47.5c6 0 11-2 14.7-5.4l-7.4-5.7c-2 1.4-4.7 2.3-7.3 2.3-6.6 0-12.2-3.9-14-9.4L2.5 35C6.4 43 14.6 47.5 24 47.5z" />
    </svg>
  );
}

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
