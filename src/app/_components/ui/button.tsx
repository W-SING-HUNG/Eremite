import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "small" | "medium";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}>(({ variant = "secondary", size = "medium", loading = false, className = "", disabled, children, ...props }, ref) => (
  <button
    {...props}
    ref={ref}
    className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
  >
    {loading && <span className="ui-spinner" aria-hidden="true" />}{children}
  </button>
));
Button.displayName = "Button";

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: ButtonSize;
  pressed?: boolean;
}>(({ label, size = "medium", pressed, className = "", children, ...props }, ref) => (
  <button {...props} ref={ref} className={`ui-icon-button ui-icon-button--${size} ${className}`.trim()} aria-label={label} aria-pressed={pressed}>{children}</button>
));
IconButton.displayName = "IconButton";
