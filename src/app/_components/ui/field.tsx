import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function Field({ label, description, error, required, children, className = "" }: {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: (ids: { controlId: string; descriptionId?: string; errorId?: string }) => React.ReactNode;
  className?: string;
}) {
  const generated = useId();
  const controlId = `field-${generated}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return <div className={`ui-field ${error ? "ui-field--error" : ""} ${className}`.trim()}>
    <label className="ui-field__label" htmlFor={controlId}>{label}{required && <span aria-hidden="true">*</span>}</label>
    {children({ controlId, descriptionId, errorId })}
    {description && <div className="ui-field__description" id={descriptionId}>{description}</div>}
    {error && <div className="ui-field__error" id={errorId} role="alert">{error}</div>}
  </div>;
}

export function ControlField({ label, description, error, children, className = "" }: {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`ui-field ${error ? "ui-field--error" : ""} ${className}`.trim()}>
    <span className="ui-field__label">{label}</span>
    {children}
    {description && <div className="ui-field__description">{description}</div>}
    {error && <div className="ui-field__error" role="alert">{error}</div>}
  </div>;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className = "", ...props }, ref) => (
  <input {...props} ref={ref} className={`ui-input ${className}`.trim()} />
));
TextInput.displayName = "TextInput";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className = "", ...props }, ref) => (
  <textarea {...props} ref={ref} className={`ui-textarea ${className}`.trim()} />
));
TextArea.displayName = "TextArea";

export function CheckboxField({ label, description, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: React.ReactNode }) {
  const id = useId();
  return <label className={`ui-checkbox ${className}`.trim()} htmlFor={id}>
    <input {...props} id={id} type="checkbox" />
    <span className="ui-checkbox__indicator" aria-hidden="true" />
    <span className="ui-checkbox__copy"><span className="ui-checkbox__label">{label}</span>{description && <small>{description}</small>}</span>
  </label>;
}
