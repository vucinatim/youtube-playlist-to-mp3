import { NextResponse } from "next/server";

const FLASK_BASE = process.env.FLASK_BASE_URL || "http://127.0.0.1:5328";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const backendUrl = `${FLASK_BASE}/analyze`;

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorData = await response.text();
      return NextResponse.json(
        { error: `Backend error: ${errorData}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
