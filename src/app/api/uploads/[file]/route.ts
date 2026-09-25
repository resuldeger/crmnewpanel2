import { NextResponse } from "next/server";
import { readUpload } from "@/server/booking/uploads";

export const runtime = "nodejs";

/** Streams a stored reference image. Nothing is served straight off disk. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const found = await readUpload(file);
  if (!found) return NextResponse.json({ message: "Not found" }, { status: 404 });

  return new NextResponse(found.stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": found.type,
      "Content-Length": String(found.size),
      // Keys are random UUIDs and never reused, so this is safe to cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
