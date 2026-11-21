"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

/**
 * Accessible dialog built on <dialog>: focus trap, Esc to close, labelled title.
 * Always centred, on phones, tablets and desktops, with a margin so it never
 * touches the screen edge and a scroll area if the content is tall.
 *
 * `bare` drops the title row so the content can bring its own heading
 * (pass `labelledBy` with that heading's id).
 */
export function Modal({ open, onClose, title, children, dismissable = true, bare = false, labelledBy }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; dismissable?: boolean; bare?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={bare ? labelledBy : titleId}
      aria-label={bare && !labelledBy ? title : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClick={(e) => { if (dismissable && e.target === ref.current) onClose(); }}
      className="senda-dialog m-auto w-[calc(100vw-2rem)] max-w-md rounded-[1.75rem] bg-white p-0 text-ink shadow-2xl ring-1 ring-line backdrop:bg-night/70 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="max-h-[min(85dvh,44rem)] overflow-y-auto p-5 sm:p-6">
          {!bare && (
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
              {dismissable && (
                <button type="button" onClick={onClose} className="tap -mr-2 -mt-2 inline-flex items-center justify-center rounded-full hover:bg-cloud" aria-label="Close">
                  <X size={20} />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}
