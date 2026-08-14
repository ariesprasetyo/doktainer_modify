import { NextRequest, NextResponse } from "next/server";

const REPLACEMENT_HINT =
  "This endpoint no longer receives webhooks. Use /api/v1/webhooks/github/<gitProviderId>, which verifies the X-Hub-Signature-256 header and can trigger a deploy.";

export async function GET() {
  return NextResponse.json(
    { success: false, error: REPLACEMENT_HINT },
    { status: 410 },
  );
}

/**
 * Deliberately fails.
 *
 * This route used to answer 200 while discarding the payload, so GitHub showed
 * green deliveries for pushes that never deployed anything. A 410 makes the
 * misconfiguration visible in the provider's delivery log instead of hiding it.
 */
export async function POST(request: NextRequest) {
  const event = request.headers.get("x-github-event") || "unknown";
  return NextResponse.json(
    { success: false, event, error: REPLACEMENT_HINT },
    { status: 410 },
  );
}
