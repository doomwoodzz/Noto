// The compact preview card shown when hovering an inline citation chip.
//
// A single instance is mounted by LiveMarkdownEditor and driven by an `anchor`
// (the hovered chip element, or null). It portals to <body> so it escapes the
// editor's overflow. It stays mounted once first shown and fades purely via the
// `is-open` class, so both fade-in and fade-out animate and the content lingers
// during fade-out. Metadata/thumbnail come from the shared citationCache
// (fetched at most once per URL); position is applied imperatively before paint.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CitationClient, CitationMeta } from "./citationClient";
import {
  ensureCitationImage,
  ensureCitationMeta,
  getCitationImage,
  getCitationMeta,
} from "./citationCache";

interface Props {
  /** The hovered chip element, or null to dismiss. */
  anchor: HTMLElement | null;
  client: CitationClient;
  /** Keep the card open while the pointer is over it. */
  onPointerEnter: () => void;
  /** Begin dismissing once the pointer leaves the card. */
  onPointerLeave: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CitationHoverCard({ anchor, client, onPointerEnter, onPointerLeave }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Keep showing the last chip during fade-out (adjust state during render — the
  // documented React pattern for deriving from a changed prop, not an effect).
  const [lastShown, setLastShown] = useState<HTMLElement | null>(null);
  if (anchor && anchor !== lastShown) setLastShown(anchor);
  const display = anchor ?? lastShown;
  const url = display?.getAttribute("data-url") ?? "";

  // Metadata/thumbnail are read from the cache during render; the effects below
  // only setState from async callbacks (so the cache stays the source of truth).
  const [metaState, setMetaState] = useState<CitationMeta | null>(null);
  const [imgState, setImgState] = useState<{ url: string; data: string | null } | null>(null);
  const meta = metaState && metaState.url === url ? metaState : getCitationMeta(url) ?? null;
  // The thumbnail is keyed/fetched by its own image URL, not the page URL.
  const imageUrl = meta?.imageUrl ?? null;
  const img = imageUrl
    ? imgState && imgState.url === imageUrl
      ? imgState.data
      : getCitationImage(imageUrl) ?? null
    : null;

  useEffect(() => {
    if (!url) return;
    let active = true;
    ensureCitationMeta(url, client)
      .then((m) => {
        if (active) setMetaState(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [url, client]);

  useEffect(() => {
    if (!imageUrl) return;
    let active = true;
    ensureCitationImage(imageUrl, client)
      .then((d) => {
        if (active) setImgState({ url: imageUrl, data: d });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [imageUrl, client]);

  // Position from the anchor's rect, flipping above if it would overflow below.
  // Applied imperatively (no state) so it lands before the browser paints.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!display || !card) return;
    const a = display.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const left = Math.min(
      Math.max(a.left, margin),
      Math.max(margin, window.innerWidth - r.width - margin),
    );
    let top = a.bottom + gap;
    if (top + r.height > window.innerHeight - margin && a.top - gap - r.height > margin) {
      top = a.top - gap - r.height;
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }, [display, anchor, meta, img]);

  if (!display) return null;

  const host = meta?.host || hostOf(url);
  const title = meta?.title || meta?.siteName || host;
  const date = formatDate(meta?.publishedDate ?? null);
  const fav = meta?.faviconDataUrl;

  return createPortal(
    <div
      ref={cardRef}
      className={"nw-cite-card" + (anchor ? " is-open" : "")}
      style={{ left: -9999, top: -9999 }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      role="tooltip"
    >
      {img && (
        <div className="nw-cite-thumb">
          <img src={img} alt="" />
        </div>
      )}
      <div className="nw-cite-cardbody">
        <div className="nw-cite-cardtitle">{title}</div>
        {meta?.description ? <div className="nw-cite-carddesc">{meta.description}</div> : null}
        <div className="nw-cite-cardfoot">
          <span
            className="nw-cite-fav"
            style={fav ? { backgroundImage: `url("${fav}")` } : undefined}
          />
          <span className="nw-cite-cardhost">{host}</span>
          {date && <span className="nw-cite-carddate">{date}</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
