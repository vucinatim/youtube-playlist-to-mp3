/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASK_BASE = process.env.FLASK_BASE_URL || "http://127.0.0.1:5328";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get("videoId");
    if (!videoId) {
      return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
    }

    const upstream = await fetch(
      `${FLASK_BASE}/detect-key?videoId=${encodeURIComponent(videoId)}`,
      { cache: "no-store" }
    );
    const text = await upstream.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "Invalid upstream response" };
    }
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Proxy detect-key error:", err);
    return NextResponse.json(
      { error: "Failed to proxy detect-key" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const upstream = await fetch(`${FLASK_BASE}/detect-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await upstream.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "Invalid upstream response" };
    }
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Proxy detect-keys error:", err);
    return NextResponse.json(
      { error: "Failed to proxy detect-keys" },
      { status: 500 }
    );
  }
}
