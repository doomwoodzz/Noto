import { ArrowRight, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface FeatureSectionProps {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: ReactNode;
  desc: ReactNode;
  bullets: ReactNode[];
  cta: { label: string; href: string };
  media: ReactNode;
  /** When true, the media sits on the left and text on the right. */
  reverse?: boolean;
  /** Visual treatment of the media panel. */
  mediaTone?: "dark" | "light";
}

export function FeatureSection({
  id, icon: Icon, eyebrow, title, desc, bullets, cta, media,
  reverse = false, mediaTone = "dark",
}: FeatureSectionProps) {
  return (
    <section className={"f-feature" + (reverse ? " is-reverse" : "")} id={id}>
      <div className="f-feature-copy">
        <div className="f-feature-eyebrow">
          <span className="f-feature-eyebrow-icn"><Icon size={14} strokeWidth={1.7} /></span>
          {eyebrow}
        </div>
        <h3 className="f-feature-title">{title}</h3>
        <p className="f-feature-desc">{desc}</p>
        <ul className="f-feature-list">
          {bullets.map((b, i) => (
            <li key={i}>
              <Check size={14} strokeWidth={2} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <a href={cta.href} className="l-btn-link">
          {cta.label} <ArrowRight size={13} strokeWidth={1.7} />
        </a>
      </div>
      <div className={"f-feature-media f-media-" + mediaTone}>
        <div className="f-feature-media-inner">{media}</div>
      </div>
    </section>
  );
}
