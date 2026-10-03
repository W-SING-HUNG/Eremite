export function classifyPdfFailure(error: unknown): "corrupted" | "load_failed" {
  if (!(error instanceof Error)) return "load_failed";
  return /password|encrypted|invalid|format|structure|missing pdf|unexpected response/i.test(`${error.name} ${error.message}`) ? "corrupted" : "load_failed";
}

export function classifyDocxFailure(error: unknown): "corrupted" | "load_failed" {
  if (!(error instanceof Error)) return "load_failed";
  return /zip|document|parse|xml|encrypted|central directory/i.test(`${error.name} ${error.message}`) ? "corrupted" : "load_failed";
}
