/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASK_BASE = process.env.FLASK_BASE_URL || "http://127.0.0.1:5328";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const upstream = await fetch(`${FLASK_BASE}/batch-zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Do not use cache for long-running streaming responses
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: text || "Batch failed upstream" },
        { status: upstream.status }
      );
    }

    // Stream the ZIP back to the client, preserving headers
    const headers = new Headers();
    const passthrough = [
      "content-type",
      "content-length",
      "content-disposition",
      "cache-control",
      "pragma",
      "expires",
    ];
    passthrough.forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    });

    return new NextResponse(upstream.body as any, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    console.error("Proxy batch-zip error:", err);
    return NextResponse.json(
      { error: "Failed to proxy batch-zip" },
      { status: 500 }
    );
  }
}
