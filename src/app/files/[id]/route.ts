import { NextResponse } from "next/server";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  // Keep the caller's loopback origin and port; do not use a reconstructed URL or Host headers.
  return new NextResponse(null, { status: 307, headers: { Location: `/viewer/${encodeURIComponent(id)}` } });
}
