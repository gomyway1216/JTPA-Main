import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

const intlProxy = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const response = intlProxy(request);
  // next-intl knows UI locales, but cannot know which Firestore documents
  // have translated bodies. Detail pages and the sitemap emit the actual
  // alternate set; don't contradict it with an automatic HTTP Link header.
  if (
    /^\/(ja|en)\/(events|blog|guide|showcase|qa|poll)\/[^/]+\/?$/.test(
      request.nextUrl.pathname,
    )
  ) {
    response.headers.delete("link");
  }
  return response;
}

export const config = {
  matcher: "/((?!api|_next|_vercel|__/auth|__/firebase|.*\\..*).*)",
};
