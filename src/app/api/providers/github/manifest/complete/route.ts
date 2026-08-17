import { NextRequest, NextResponse } from "next/server";

const GITHUB_ACCEPT = "application/vnd.github+json";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
  } | null;
  const code = body?.code?.trim();

  if (!code) {
    return NextResponse.json(
      { success: false, error: "GitHub manifest code is required" },
      { status: 400 },
    );
  }

  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: GITHUB_ACCEPT,
        "User-Agent": "Doktainer",
      },
    },
  );

  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok || !payload) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : "Failed to convert GitHub App manifest";
    return NextResponse.json(
      { success: false, error: message },
      { status: response.status || 400 },
    );
  }

  const data = {
    id: payload.id,
    slug: payload.slug,
    clientId: payload.client_id,
    clientSecret: payload.client_secret,
    pem: payload.pem,
    htmlUrl: payload.html_url,
    name: payload.name,
  };

  return NextResponse.json({ success: true, data });
}
