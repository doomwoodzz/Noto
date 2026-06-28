import { Icon } from "./icons";

export interface ToastItem {
  id: number;
  text: string;
}

export function Toasts({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="nw-toasts">
      {toasts.map((t) => (
        <div key={t.id} className="nw-toast">
          <span className="nw-toast-icn"><Icon name="spark" size={16} stroke={1.6} /></span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
