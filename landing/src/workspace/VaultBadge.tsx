import { tintFor } from "./vaultIcons";

interface Props {
  icon: string | null;
  color: string | null;
  name: string;
  size?: number;
}

/** Emoji-on-color-tile vault badge. Falls back to a monogram when icon is null. */
export function VaultBadge({ icon, color, name, size = 28 }: Props) {
  const style = { width: size, height: size, background: tintFor(color), fontSize: Math.round(size * 0.55) };
  return (
    <span className={"nw-vbadge" + (icon ? "" : " is-mono")} style={style} aria-hidden="true">
      {icon ?? (name[0] || "N").toUpperCase()}
    </span>
  );
}
