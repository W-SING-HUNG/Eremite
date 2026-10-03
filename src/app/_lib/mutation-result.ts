export type MutationErrorCode = "conflict" | "invalid_input" | "not_found" | "unavailable" | "blocked";

export type MutationFailure = { ok: false; code: MutationErrorCode; message: string };

export type MutationResult<T = undefined> =
  | { ok: true; value: T }
  | MutationFailure;

export function mutationSuccess<T>(value: T): MutationResult<T> {
  return { ok: true, value };
}

export function mutationErrorMessage(code: MutationErrorCode) {
  switch (code) {
    case "conflict":
      return "这项内容已在其他位置更新。请载入最新内容后再试。";
    case "invalid_input":
      return "请检查填写内容后再试。";
    case "not_found":
      return "这项内容已不存在或当前不可用。";
    case "unavailable":
      return "所选内容当前不可用，请刷新后重新选择。";
    case "blocked":
      return "当前状态不允许执行此操作。请刷新后重试。";
  }
}

export function mutationNoticeMessage(code: string) {
  return isMutationErrorCode(code)
    ? mutationErrorMessage(code)
    : "操作未能完成，请刷新后重试。";
}

function isMutationErrorCode(code: string): code is MutationErrorCode {
  return ["conflict", "invalid_input", "not_found", "unavailable", "blocked"].includes(code);
}
