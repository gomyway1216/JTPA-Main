import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

const intlProxy = createMiddleware(routing);
const localeHeader = "X-NEXT-INTL-LOCALE";

function hasDefaultLocalePrefix(pathname: string) {
  const prefix = `/${routing.defaultLocale}`;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export default function proxy(request: NextRequest) {
  if (hasDefaultLocalePrefix(request.nextUrl.pathname)) {
    const headers = new Headers(request.headers);
    headers.set(localeHeader, routing.defaultLocale);
    return NextResponse.next({ request: { headers } });
  }

  return intlProxy(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
