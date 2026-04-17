import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  const expected = process.env.ALEXA_BRIDGE_API_KEY;
  if (expected && key !== expected) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, speech: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const query = body.query?.trim();
    if (!query) return NextResponse.json({ ok: false, speech: "What would you like to ask about?" }, { status: 400 });

    const res = await fetch("http://localhost:3000/api/agent/axon/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: query }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await res.json();
    const answer = data.answer ?? "I could not find an answer.";

    // Trim for voice — max 200 chars
    const speech = answer.length > 200 ? answer.slice(0, 197) + "..." : answer;

    return NextResponse.json({ ok: true, speech });
  } catch {
    return NextResponse.json({ ok: false, speech: "Knowledge graph query failed." }, { status: 502 });
  }
}
