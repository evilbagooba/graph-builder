// Small UI primitives on native HTML, styled in theme.css (the "UI
// primitives" section). No component library: each piece is the platform
// element plus the minimum JavaScript the platform doesn't provide yet
// (menu arrow-key roving and placement, a toast queue).

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---- Button ----

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  /** Shows a spinner and blocks clicks without changing the button's width. */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      className={cx("gb-btn", className)}
      {...rest}
    >
      <span className="gb-btn-label">{children}</span>
      {loading && <span aria-hidden className="gb-btn-spinner" />}
    </button>
  );
});

// ---- Text fields ----

type FieldProps = {
  label: ReactNode;
  /** Visually hide the label; it stays the field's accessible name. */
  hideLabel?: boolean;
  description?: ReactNode;
  errorMessage?: ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
};

function FieldFrame({
  id,
  label,
  hideLabel,
  description,
  errorMessage,
  invalid,
  wrapperClassName,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  const showError = invalid && errorMessage;
  return (
    <div className={cx("gb-field", wrapperClassName)}>
      <label htmlFor={id} className={cx("gb-label", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {showError ? (
        <p id={`${id}-msg`} role="alert" className="gb-field-error">
          {errorMessage}
        </p>
      ) : description ? (
        <p id={`${id}-msg`} className="gb-field-description">
          {description}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: "sm" | "md" };

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, description, errorMessage, invalid, wrapperClassName, size = "md", className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hasMsg = (invalid && errorMessage) || description;
  return (
    <FieldFrame
      id={fieldId}
      {...{ label, hideLabel, description, errorMessage, invalid, wrapperClassName }}
    >
      <input
        ref={ref}
        id={fieldId}
        data-size={size}
        aria-invalid={invalid || undefined}
        aria-describedby={hasMsg ? `${fieldId}-msg` : undefined}
        className={cx("gb-input", className)}
        {...rest}
      />
    </FieldFrame>
  );
});

type TextareaProps = FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hideLabel, description, errorMessage, invalid, wrapperClassName, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hasMsg = (invalid && errorMessage) || description;
  return (
    <FieldFrame
      id={fieldId}
      {...{ label, hideLabel, description, errorMessage, invalid, wrapperClassName }}
    >
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={invalid || undefined}
        aria-describedby={hasMsg ? `${fieldId}-msg` : undefined}
        className={cx("gb-input gb-textarea", className)}
        {...rest}
      />
    </FieldFrame>
  );
});

// ---- Pick-one groups (segmented control, colour swatches) ----

/** A <fieldset> of real radio inputs: arrow keys move between options and
 * screen readers announce "n of m", natively. `variant` only changes CSS. */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  variant,
  hideLabel,
}: {
  label: ReactNode;
  /** Visually hide the legend; it stays the group's accessible name. */
  hideLabel?: boolean;
  value: T;
  options: {
    value: T;
    label: ReactNode;
    ariaLabel?: string;
    /** Visual hover/focus tooltip (CSS `data-tip`); the input keeps `ariaLabel`. */
    tip?: string;
    tipPlacement?: "top" | "top-start" | "top-end";
  }[];
  onChange: (v: T) => void;
  variant: "segmented" | "swatches";
}) {
  const name = useId();
  return (
    <fieldset className={`gb-choices gb-${variant}`}>
      <legend className={hideLabel ? "sr-only" : "gb-label"}>{label}</legend>
      <div className="gb-choices-options">
        {options.map((o) => (
          <label
            key={o.value}
            className="gb-choice"
            data-tip={o.tip}
            data-tip-placement={o.tip ? (o.tipPlacement ?? "top") : undefined}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              aria-label={o.ariaLabel}
              className="gb-choice-input"
            />
            <span className="gb-choice-face">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---- Switch ----

/** A checkbox with role="switch": native keyboard, form and label behaviour. */
export function Switch({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="gb-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="gb-switch-input"
      />
      <span aria-hidden className="gb-switch-track" />
      <span>{children}</span>
    </label>
  );
}

// ---- Dialog ----

/** A real <dialog> opened with showModal(): focus trap, inert page behind,
 * Escape to close and ::backdrop all come from the browser. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => onOpenChange(false)}
      // Clicking the backdrop (the dialog element itself, outside its box) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
      className="gb-dialog"
    >
      <div className="gb-dialog-body">
        <h2 id={titleId} className="gb-dialog-title">
          {title}
        </h2>
        {description && (
          <p id={descId} className="gb-dialog-description">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}

// ---- Menu ----
// Popover API (`popover="auto"`): top layer, outside-click and Escape
// dismissal are native. JS adds what the platform lacks: placing the panel
// under its trigger, and the WAI-ARIA menu's arrow-key roving.

const MenuContext = createContext<{ close: () => void } | null>(null);

export function Menu({
  label,
  trigger,
  align = "end",
  size = "sm",
  textTrigger = false,
  children,
}: {
  /** Accessible name of the trigger button (and of the menu). */
  label: string;
  /** The trigger shows text (its accessible name) instead of an icon. */
  textTrigger?: boolean;
  size?: "sm" | "md";
  /** Visible content of the trigger button. */
  trigger: ReactNode;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const items = () =>
    [...(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    const p = panelRef.current;
    if (!t || !p) return;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let left = align === "end" ? t.right - w : t.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = t.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, t.top - h - 6);
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }, [align]);

  useEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        place();
        items()[0]?.focus();
      }
    };
    p.addEventListener("toggle", onToggle);
    return () => p.removeEventListener("toggle", onToggle);
  }, [place]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);

  const close = useCallback(() => {
    panelRef.current?.hidePopover();
    triggerRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") panelRef.current?.hidePopover();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        aria-label={textTrigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        data-variant="ghost"
        data-size={size}
        className={textTrigger ? "gb-btn" : "gb-btn gb-icon-btn"}
      >
        <span className="gb-btn-label">{trigger}</span>
      </button>
      <div ref={panelRef} id={id} popover="auto" role="menu" aria-label={label} onKeyDown={onKeyDown} className="gb-menu">
        <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
      </div>
    </>
  );
}

export function MenuItem({
  onSelect,
  destructive,
  checked,
  children,
}: {
  onSelect: () => void;
  destructive?: boolean;
  /** Makes it a toggle (role="menuitemcheckbox") showing a check when on. */
  checked?: boolean;
  children: ReactNode;
}) {
  const menu = useContext(MenuContext);
  const isToggle = checked !== undefined;
  return (
    <button
      type="button"
      role={isToggle ? "menuitemcheckbox" : "menuitem"}
      aria-checked={isToggle ? checked : undefined}
      tabIndex={-1}
      data-destructive={destructive || undefined}
      className="gb-menu-item"
      onClick={() => {
        menu?.close();
        onSelect();
      }}
    >
      {isToggle && (
        <span aria-hidden className="gb-menu-check">
          {checked ? "✓" : ""}
        </span>
      )}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="gb-menu-separator" />;
}

// ---- Toasts ----
// A tiny module-level queue. `toast()` works from anywhere; <Toaster/> is
// mounted once. danger/warning toasts are role="alert" (assertive); the
// rest are announced politely by the container. Hovering pauses the timer.

type ToastVariant = "default" | "success" | "warning" | "danger";
type ToastItem = { id: string; message: ReactNode; variant: ToastVariant };

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const emit = () => listeners.forEach((l) => l());
let nextId = 0;

function startTimer(id: string, variant: ToastVariant) {
  const ms = variant === "danger" || variant === "warning" ? 8000 : 4000;
  timers.set(id, setTimeout(() => dismiss(id), ms));
}

function dismiss(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function show(message: ReactNode, variant: ToastVariant = "default") {
  const id = `toast-${++nextId}`;
  toasts = [...toasts.slice(-2), { id, message, variant }]; // keep at most 3
  startTimer(id, variant);
  emit();
  return id;
}

export const toast = Object.assign(show, {
  success: (m: ReactNode) => show(m, "success"),
  warning: (m: ReactNode) => show(m, "warning"),
  danger: (m: ReactNode) => show(m, "danger"),
  dismiss,
});

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    // Always mounted: a live region only announces changes once it exists.
    <div className="gb-toaster" aria-live="polite" aria-relevant="additions">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.variant === "danger" || t.variant === "warning" ? "alert" : undefined}
          data-variant={t.variant}
          className="gb-toast"
          onPointerEnter={() => clearTimeout(timers.get(t.id))}
          onPointerLeave={() => startTimer(t.id, t.variant)}
        >
          <p className="min-w-0 flex-1">{t.message}</p>
          <button type="button" aria-label="Dismiss" className="gb-toast-close" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
