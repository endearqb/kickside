import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.closest('[hidden], [aria-hidden="true"], [inert]'),
  );
}

export function useDialogFocusBoundary(active: boolean) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;
    const activeDialog = dialog;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = activeDialog.querySelector<HTMLElement>("[data-dialog-autofocus]");
      (preferred ?? focusableElements(activeDialog)[0] ?? activeDialog).focus();
    });

    function keepFocusInside(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const focusable = focusableElements(activeDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    activeDialog.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      activeDialog.removeEventListener("keydown", keepFocusInside);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [active]);

  return dialogRef;
}
