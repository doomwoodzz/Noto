import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue } from "framer-motion";
import { Icon, type IconName } from "./icons";
import type { PaneId, Tab } from "./types";
import type { Workspace } from "./useWorkspace";

interface Props {
  ws: Workspace;
  noteTitle: (fileId: string | undefined) => string;
  renderBody: (tab: Tab) => ReactNode;
}

function kindIcon(kind: Tab["kind"]): IconName {
  return kind === "graph" ? "graph" : kind === "home" ? "home" : "file";
}

/** Pointer travel (px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;

interface DragState {
  tab: Tab;
  fromPane: PaneId;
  fromIndex: number;
  width: number;
  height: number;
  /** Pointer offset inside the grabbed chip, so the ghost stays under the cursor. */
  grabDX: number;
  grabDY: number;
}

interface DropTarget {
  pane: PaneId;
  /** Insertion index within the pane's tabs, excluding the dragged tab. */
  index: number;
}

type Dnd = ReturnType<typeof useTabDnd>;

export function WorkspacePanes({ ws, noteTitle, renderBody }: Props) {
  const label = useCallback(
    (t: Tab) =>
      t.kind === "graph" ? "Knowledge Web" : t.kind === "home" ? "Home" : noteTitle(t.fileId),
    [noteTitle],
  );
  const rootRef = useRef<HTMLElement>(null);
  const dnd = useTabDnd(ws, rootRef);
  // The floating tab is shown both while dragging and during the release fly-in.
  const ghost = dnd.drag
    ? { tab: dnd.drag.tab, width: dnd.drag.width, height: dnd.drag.height }
    : dnd.fly;

  return (
    <main className="nw-workspace" ref={rootRef}>
      <Pane pane="left" ws={ws} label={label} renderBody={renderBody} dnd={dnd} />
      {ws.rightTabs && (
        <Pane pane="right" ws={ws} label={label} renderBody={renderBody} dnd={dnd} split />
      )}

      {/* Floating tab that follows the cursor while dragging, then eases into
          its landing slot after release. Portalled to the document body so
          neither the tab bar's overflow clip nor any scaled/transformed ancestor
          (e.g. the marketing preview) distorts it. */}
      {ghost &&
        createPortal(
          <motion.div
            className="nw-tab nw-tab--ghost is-active"
            style={{ x: dnd.x, y: dnd.y, scale: dnd.scale, width: ghost.width, height: ghost.height }}
          >
            <span className="nw-tab-icn">
              <Icon name={kindIcon(ghost.tab.kind)} size={13} stroke={1.7} />
            </span>
            <span className="nw-tab-title">{label(ghost.tab)}</span>
            <span className="nw-tab-close">
              <Icon name="close" size={13} stroke={1.9} />
            </span>
          </motion.div>,
          document.body,
        )}
    </main>
  );
}

function Pane({
  pane,
  ws,
  label,
  renderBody,
  dnd,
  split,
}: {
  pane: PaneId;
  ws: Workspace;
  label: (t: Tab) => string;
  renderBody: (tab: Tab) => ReactNode;
  dnd: Dnd;
  split?: boolean;
}) {
  const tabs = pane === "left" ? ws.leftTabs : ws.rightTabs ?? [];
  const activeId = pane === "left" ? ws.leftActive : ws.rightActive;
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const draggingId = dnd.drag?.tab.id;
  // Where the gap should open in this pane (drop preview / landing slot).
  const gapAt = dnd.drag && dnd.drop?.pane === pane ? dnd.drop.index : -1;

  // Build the chip row: every tab except the one in flight, with an invisible
  // placeholder inserted at the drop index. Each chip animates its own layout,
  // so neighbours slide aside (and back) whenever the placeholder appears, moves,
  // or the dragged chip lifts out.
  const chips: ReactNode[] = [];
  let visibleIndex = 0;
  tabs.forEach((t, originalIndex) => {
    if (t.id === draggingId) return;
    if (visibleIndex === gapAt && dnd.drag) {
      chips.push(<DropSlot key="__drop" w={dnd.drag.width} h={dnd.drag.height} />);
    }
    chips.push(
      <TabChip
        key={t.id}
        tab={t}
        active={t.id === activeTab?.id}
        label={label(t)}
        onPointerDown={(e) => dnd.onPointerDown(pane, t, originalIndex, e)}
        onActivate={() => ws.activate(pane, t.id)}
        onClose={() => ws.closeTab(pane, t.id)}
      />,
    );
    visibleIndex += 1;
  });
  if (visibleIndex === gapAt && dnd.drag) {
    chips.push(<DropSlot key="__drop" w={dnd.drag.width} h={dnd.drag.height} />);
  }

  return (
    <section
      data-pane={pane}
      className={"nw-pane" + (split ? " is-split" : "") + (gapAt >= 0 ? " is-drop-target" : "")}
    >
      <div className="nw-tabbar" data-tabbar>
        {chips}
        {pane === "left" && (
          <button className="nw-tab-add" onClick={ws.openHome} title="New tab" aria-label="New tab">
            <Icon name="plus" size={15} stroke={1.9} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        {pane === "left" && !ws.rightTabs && (
          <button className="nw-tab-add" onClick={ws.splitActive} title="Open beside" aria-label="Open beside">
            <Icon name="split" size={15} stroke={1.7} />
          </button>
        )}
        {pane === "right" && (
          <button className="nw-tab-add" onClick={ws.closeSplit} title="Close split" aria-label="Close split">
            <Icon name="close" size={13} stroke={1.9} />
          </button>
        )}
      </div>
      <div className="nw-pane-body">
        {activeTab ? renderBody(activeTab) : <div className="nw-empty nw-empty-pane">No tab open</div>}
      </div>
    </section>
  );
}

const TAB_LAYOUT_SPRING = { type: "spring", stiffness: 650, damping: 46 } as const;

function TabChip({
  tab,
  active,
  label,
  onPointerDown,
  onActivate,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  label: string;
  onPointerDown: (e: ReactPointerEvent) => void;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      layout
      transition={{ layout: TAB_LAYOUT_SPRING }}
      data-tab-id={tab.id}
      className={"nw-tab" + (active ? " is-active" : "")}
      onPointerDown={onPointerDown}
      onClick={onActivate}
    >
      <span className="nw-tab-icn">
        <Icon name={kindIcon(tab.kind)} size={13} stroke={1.7} />
      </span>
      <span className="nw-tab-title">{label}</span>
      <span
        className="nw-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <Icon name="close" size={13} stroke={1.9} />
      </span>
    </motion.div>
  );
}

/** Invisible spacer that holds the gap where the dragged tab will land. */
function DropSlot({ w, h }: { w: number; h: number }) {
  return (
    <motion.div
      layout
      transition={{ layout: TAB_LAYOUT_SPRING }}
      className="nw-tab-slot"
      data-drop
      style={{ width: w, height: h }}
    />
  );
}

/**
 * Pointer-driven tab dragging.
 *
 * A press that travels past the threshold lifts the tab into a floating ghost
 * that tracks the cursor; the original chip is removed from its row so the gap
 * closes. While dragging we hit-test the panes to choose a landing slot and
 * render an invisible placeholder there, which nudges the other tabs aside.
 *
 * On release the ghost eases into the landing slot and the move is committed.
 * If the cursor is over the tab's own slot (or off the panes entirely) the
 * landing slot defaults to home, so the tab eases back into place — the
 * accessible "release to cancel" behaviour, with symmetric ease-in/ease-out.
 */
function useTabDnd(ws: Workspace, rootRef: RefObject<HTMLElement | null>) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  // The released tab, easing into its landing slot. Purely cosmetic — the move
  // itself is already committed — so it can be cleared on a timer and never
  // strands the ghost if the frame loop is paused.
  const [fly, setFly] = useState<{ tab: Tab; width: number; height: number } | null>(null);

  // Ghost transform, driven imperatively so cursor tracking never re-renders.
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);

  // Live mirrors of drag/drop readable synchronously from the window-level
  // pointer handlers (which only ever set them — never during render).
  const dragRef = useRef<DragState | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Which pane + insertion index the cursor is over. Falls back to `home` (the
  // tab's own slot) when the cursor is outside every pane.
  const computeDrop = useCallback(
    (px: number, py: number, home: DropTarget): DropTarget => {
      const sections = rootRef.current?.querySelectorAll<HTMLElement>("section[data-pane]");
      for (const sec of sections ?? []) {
        const r = sec.getBoundingClientRect();
        if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
        const bar = sec.querySelector<HTMLElement>("[data-tabbar]");
        const chips = bar ? [...bar.querySelectorAll<HTMLElement>("[data-tab-id]")] : [];
        let index = chips.length;
        for (let i = 0; i < chips.length; i++) {
          const cr = chips[i].getBoundingClientRect();
          if (px < cr.left + cr.width / 2) {
            index = i;
            break;
          }
        }
        return { pane: (sec.dataset.pane as PaneId) ?? home.pane, index };
      }
      return home;
    },
    [rootRef],
  );

  const onPointerDown = useCallback(
    (pane: PaneId, tab: Tab, index: number, e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".nw-tab-close")) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const grabDX = startX - rect.left;
      const grabDY = startY - rect.top;
      const home: DropTarget = { pane, index };
      let started = false;

      const move = (ev: PointerEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
          started = true;
          const d: DragState = {
            tab,
            fromPane: pane,
            fromIndex: index,
            width: rect.width,
            height: rect.height,
            grabDX,
            grabDY,
          };
          x.set(ev.clientX - grabDX);
          y.set(ev.clientY - grabDY);
          scale.set(1);
          dragRef.current = d;
          dropRef.current = home;
          setDrag(d);
          setDrop(home);
          // Pop out of place.
          animate(scale, 1.045, { duration: 0.18, ease: [0.22, 1, 0.36, 1] });
          document.body.classList.add("nw-tab-dragging");
        }
        x.set(ev.clientX - grabDX);
        y.set(ev.clientY - grabDY);
        const next = computeDrop(ev.clientX, ev.clientY, home);
        const prev = dropRef.current;
        if (!prev || prev.pane !== next.pane || prev.index !== next.index) {
          dropRef.current = next;
          setDrop(next);
        }
      };

      const finish = () => {
        const d = dragRef.current;
        if (!d) {
          document.body.classList.remove("nw-tab-dragging");
          return;
        }
        const target = dropRef.current ?? home;
        const isReturn = target.pane === d.fromPane && target.index === d.fromIndex;

        // Land on the placeholder slot currently reserved in the target pane.
        const slot = rootRef.current?.querySelector<HTMLElement>("[data-drop]");
        const r = slot?.getBoundingClientRect();
        const toX = r ? r.left : x.get();
        const toY = r ? r.top : y.get();

        // Commit the move now, synchronously — before any animation — so it can
        // never be lost if the landing tween is interrupted or never runs.
        if (!isReturn) ws.moveTab({ pane: d.fromPane, id: d.tab.id }, target);
        // Hand the ghost off to the cosmetic fly-into-place phase and end the
        // gesture. Chips now render in their final arrangement underneath.
        dragRef.current = null;
        dropRef.current = null;
        setFly({ tab: d.tab, width: d.width, height: d.height });
        setDrag(null);
        setDrop(null);

        // Returning home eases in *and* out (symmetric); a committed drop pops in.
        const opts = isReturn
          ? { duration: 0.34, ease: [0.45, 0, 0.55, 1] as const }
          : { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };
        let cleared = false;
        const clearFly = () => {
          if (cleared || !alive.current) return;
          cleared = true;
          document.body.classList.remove("nw-tab-dragging");
          setFly(null);
        };
        const ax = animate(x, toX, opts);
        animate(y, toY, opts);
        animate(scale, 1, opts);
        void ax.finished.then(clearFly).catch(() => {});
        // Belt-and-braces: clear on a timer too, so a paused frame loop (hidden
        // tab, reduced motion) can never strand the ghost on screen.
        window.setTimeout(clearFly, opts.duration * 1000 + 150);
      };

      const end = (snapHome: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", onCancel);
        if (!started) return;
        // An interrupted gesture (touch cancelled, lost capture) returns home.
        if (snapHome) dropRef.current = home;
        finish();
      };
      const up = () => end(false);
      const onCancel = () => end(true);

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", onCancel);
    },
    [computeDrop, ws, x, y, scale, rootRef],
  );

  return { drag, drop, fly, x, y, scale, onPointerDown };
}
