export interface Toast {
  id: number;
  kind: "match" | "info" | "error";
  message: string;
}

export default function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} onClick={() => onDismiss(toast.id)}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
