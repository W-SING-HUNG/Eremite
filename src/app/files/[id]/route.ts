import { NextResponse } from "next/server";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  return NextResponse.redirect(new URL(`/viewer/${encodeURIComponent(id)}`, request.url), 307);
}
