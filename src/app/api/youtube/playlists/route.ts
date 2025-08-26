/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASK_BASE = process.env.FLASK_BASE_URL || "http://127.0.0.1:5328";

export async function GET() {
  try {
    const upstream = await fetch(`${FLASK_BASE}/playlists`, {
      cache: "no-store",
    });
    const text = await upstream.text();
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to proxy playlists" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const upstream = await fetch(`${FLASK_BASE}/playlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Avoid sending undefined values; Flask json parser is strict sometimes
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    const text = await upstream.text();
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to proxy save playlist" },
      { status: 500 }
    );
  }
}
