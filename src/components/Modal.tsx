import { useEffect, useRef, ReactNode } from 'react';

interface ModalProps {
  onClose: () => void;
  /** Accessible name for the dialog, announced on open. */
  label: string;
  children: ReactNode;
  /** Set false for destructive confirmations where a stray click should not dismiss. */
  closeOnBackdrop?: boolean;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog wrapper.
 *
 * The app previously had seven hand-rolled modals, none of which had
 * role="dialog", Escape-to-close, a focus trap, or focus restoration, and
 * several of which could only be dismissed with a mouse.
 */
export function Modal({
  onClose,
  label,
  children,
  closeOnBackdrop = true,
  className = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog so keyboard and screen-reader users start
    // inside it rather than behind it.
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter(el => el.offsetParent !== null);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      onMouseDown={closeOnBackdrop ? (e) => {
        // mouseDown on the backdrop itself, so a drag that ends outside the
        // panel does not count as a dismiss.
        if (e.target === e.currentTarget) onClose();
      } : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
