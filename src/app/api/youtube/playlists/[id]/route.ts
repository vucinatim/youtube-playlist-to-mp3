/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASK_BASE = process.env.FLASK_BASE_URL || "http://127.0.0.1:5328";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const upstream = await fetch(
      `${FLASK_BASE}/playlists/${encodeURIComponent(params.id)}`,
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
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to proxy playlist" },
      { status: 500 }
    );
  }
}
