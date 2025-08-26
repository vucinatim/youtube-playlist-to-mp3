/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASK_BASE = process.env.FLASK_BASE_URL || "http://127.0.0.1:5328";

// Next.js 15: params for dynamic API routes must be awaited
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const upstream = await fetch(
      `${FLASK_BASE}/playlists/${encodeURIComponent(id)}`,
      { cache: "no-store" }
    );
    const text = await upstream.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "Invalid upstream response" };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to proxy playlist" },
      { status: 500 }
    );
  }
}
