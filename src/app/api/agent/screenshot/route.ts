import { NextRequest, NextResponse } from "next/server";
import { PlaywrightMCPClient } from "@/lib/mcp/playwright-client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let url = process.env.SENTINELQA_TARGET_URL ?? "http://localhost:5173";

  try {
    const body = await request.json().catch(() => ({}));
    if (body.url && typeof body.url === "string") {
      url = body.url.trim();
    }
  } catch {}

  const client = new PlaywrightMCPClient();

  try {
    await client.start();

    const navResult = await client.navigate(url);
    if (!navResult.success) {
      return NextResponse.json(
        { error: `Navigation failed: ${navResult.error}` },
        { status: 502 }
      );
    }

    // Take screenshot (raw=false → JPEG, smaller file size for Telegram)
    const result = await client.screenshot(false);
    if (!result.success) {
      return NextResponse.json(
        { error: `Screenshot failed: ${result.error}` },
        { status: 502 }
      );
    }

    // MCP returns content items — image data can be in various shapes:
    // { type: "image", data: "base64...", mimeType: "image/jpeg" }
    // or { type: "text", text: "data:image/png;base64,..." }
    const content = result.content ?? [];
    let base64Image = "";
    let mimeType = "image/jpeg";

    for (const item of content) {
      const raw = item as Record<string, unknown>;

      // Shape 1: { type: "image", data: "base64..." }
      if (raw.type === "image" && typeof raw.data === "string") {
        base64Image = raw.data;
        if (typeof raw.mimeType === "string") mimeType = raw.mimeType;
        break;
      }

      // Shape 2: { type: "text", text: "data:image/...;base64,..." }
      if (raw.type === "text" && typeof raw.text === "string") {
        const text = raw.text as string;
        const match = text.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Image = match[2];
          break;
        }
        // Shape 3: raw base64 string (long string, no spaces)
        if (text.length > 200 && !/\s/.test(text.slice(0, 100))) {
          base64Image = text;
          break;
        }
      }
    }

    if (!base64Image) {
      // Debug: return what we got so we can see the format
      return NextResponse.json(
        {
          error: "No image data found in screenshot response",
          contentTypes: content.map((c) => (c as Record<string, unknown>).type),
          contentKeys: content.map((c) => Object.keys(c as Record<string, unknown>)),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, url, image: base64Image, mimeType });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Screenshot failed" },
      { status: 500 }
    );
  } finally {
    await client.stop();
  }
}
