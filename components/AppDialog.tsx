"use client";
import { useEffect, useRef } from "react";
import RampIcon from "./RampIcon";
export default function AppDialog({ title, onClose, children, drawer = false }: {
  title: string; onClose: () => void; children: React.ReactNode; drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={drawer ? "detail-panel" : "dialog"} aria-label={title} onCancel={onClose}
    onClick={(e) => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}>
    <div className="dialog-header"><h2>{title}</h2><button className="icon-button" aria-label="Close panel" onClick={onClose}><RampIcon name="close" /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
