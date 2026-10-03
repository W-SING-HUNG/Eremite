"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MutationResult } from "@/app/_lib/mutation-result";
import { showToast } from "@/app/_components/ui/toast";

type MutationAction<T> = (data: FormData) => Promise<MutationResult<T>>;

export function MutationForm<T>({ action, className, id, onSuccess, onConflict, successMessage, children }: {
  action: MutationAction<T>;
  className?: string;
  id?: string;
  onSuccess?: (value: T, form: HTMLFormElement) => void;
  onConflict?: () => void;
  successMessage?: string;
  children: (state: { pending: boolean }) => ReactNode;
}) {
  const pendingRef = useRef(false);
  const failureId = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Extract<MutationResult<T>, { ok: false }> | null>(null);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) throw fatalError;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const form = event.currentTarget;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    let result: MutationResult<T>;
    try {
      result = await action(new FormData(form));
    } catch (error) {
      setFatalError(asError(error));
      return;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    if (!result.ok) {
      setFailure(result);
      return;
    }
    try {
      if (successMessage) showToast({ title: successMessage, tone: "success" });
      onSuccess?.(result.value, form);
    } catch (error) {
      setFatalError(asError(error));
    }
  };

  return <form className={className} id={id} onSubmit={submit} aria-busy={pending} aria-describedby={failure ? failureId : undefined}>
    {children({ pending })}
    {failure && <div className="mutation-feedback" id={failureId} role="alert">
      <span>{failure.message}</span>
      {failure.code === "conflict" && onConflict && <button className="quiet-button" type="button" onClick={onConflict}>载入最新内容</button>}
    </div>}
  </form>;
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error("Unexpected mutation failure.");
}
