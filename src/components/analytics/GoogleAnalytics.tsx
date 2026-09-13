"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";

export function GoogleAnalytics({
  measurementId,
}: {
  measurementId: string | null;
}) {
  if (!measurementId) return null;

  return (
    <>
      <Script
        id="google-analytics"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
    </>
  );
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const firstPageView = useRef(true);

  useEffect(() => {
    // The initial `config` call above sends the first page view and captures
    // any UTM parameters. Only send explicit events for client navigation.
    if (firstPageView.current) {
      firstPageView.current = false;
      return;
    }
    const pagePath = query ? `${pathname}?${query}` : pathname;
    trackAnalyticsEvent("page_view", {
      page_location: window.location.href,
      page_path: pagePath,
      page_title: document.title,
    });
  }, [pathname, query]);

  return null;
}
