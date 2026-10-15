import { ImageResponse } from "next/og";

export const socialCardAlt =
  "Bay Area AI Study Group - Japanese AI Community in the San Francisco Bay Area";

export const socialCardSize = {
  width: 1200,
  height: 630,
};

export const socialCardContentType = "image/png";

export function createSocialCard() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#fafafa",
          color: "#18181b",
          display: "flex",
          fontFamily: "sans-serif",
          height: "100%",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#2563eb",
            display: "flex",
            width: 28,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "72px 84px 64px",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            <div
              style={{
                background: "#fb7185",
                borderRadius: 999,
                display: "flex",
                height: 18,
                marginRight: 16,
                width: 18,
              }}
            />
            SAN FRANCISCO BAY AREA
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 88,
                fontWeight: 800,
                lineHeight: 1.05,
              }}
            >
              Bay Area AI
            </div>
            <div
              style={{
                color: "#52525b",
                display: "flex",
                fontSize: 38,
                lineHeight: 1.3,
                marginTop: 28,
              }}
            >
              Japanese AI Community
            </div>
          </div>

          <div
            style={{
              alignItems: "center",
              borderTop: "2px solid #e4e4e7",
              color: "#3f3f46",
              display: "flex",
              fontSize: 27,
              justifyContent: "space-between",
              paddingTop: 28,
            }}
          >
            <span>Learn. Share. Build.</span>
            <span style={{ color: "#1d4ed8", fontWeight: 700 }}>
              bayarea-ai.com
            </span>
          </div>
        </div>
      </div>
    ),
    socialCardSize,
  );
}
