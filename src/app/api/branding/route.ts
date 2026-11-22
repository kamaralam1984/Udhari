import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/antiSpam";

/**
 * Public, unauthenticated — the login page needs the business name before a
 * session exists. Only exposes the shop name/tagline, nothing sensitive.
 * Allow-listed in src/proxy.ts's PUBLIC_PATHS.
 */
export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json({
    businessName: settings.businessName,
    businessTagline: settings.businessTagline,
    businessPhone: settings.businessPhone,
  });
}
