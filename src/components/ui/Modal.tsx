"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/** Accessible modal built on <dialog>: focus trap, Esc to close, labelled title. Bottom sheet on phones. */
export function Modal({ open, onClose, title, children, dismissable = true }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; dismissable?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-[var(--radius-sheet)] bg-white p-0 text-ink backdrop:bg-ink/50 sm:m-auto sm:max-w-md sm:rounded-[var(--radius-sheet)]"
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-xl font-semibold">{title}</h2>
            {dismissable && (
              <button type="button" onClick={onClose} className="tap -mr-2 -mt-2 inline-flex items-center justify-center rounded-full hover:bg-cloud" aria-label="Close">
                <X size={20} />
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
