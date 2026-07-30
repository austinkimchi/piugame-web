import { ImageResponse } from "next/og";

import { siteDescription, siteName } from "@/lib/site";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#f7f8f2",
          color: "#11130f",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: 64,
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "linear-gradient(90deg, #28c950, #157bda)",
            height: 22,
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
          }}
        />
        <div style={{ display: "flex", gap: 24 }}>
          <div
            style={{
              alignItems: "center",
              background: "#10130f",
              color: "#eff7e8",
              display: "flex",
              fontSize: 44,
              fontWeight: 900,
              height: 112,
              justifyContent: "center",
              position: "relative",
              width: 112,
            }}
          >
            MP
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: "#596153", fontSize: 26, fontWeight: 700 }}>Pump It Up song notebook</div>
            <div style={{ fontSize: 84, fontWeight: 900, lineHeight: 0.95 }}>{siteName}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 44, fontWeight: 800, maxWidth: 920 }}>Search Phoenix 2 songs, charts, folders, and previews.</div>
          <div style={{ color: "#4f5849", fontSize: 28, lineHeight: 1.35, maxWidth: 920 }}>{siteDescription}</div>
        </div>
      </div>
    ),
    size,
  );
}
