import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#10130f",
          color: "#eff7e8",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          fontSize: 64,
          fontWeight: 900,
          height: "100%",
          justifyContent: "center",
          letterSpacing: 0,
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ background: "#28c950", height: 34, left: 24, position: "absolute", top: 24, width: 34 }} />
        <div style={{ background: "#157bda", height: 34, position: "absolute", right: 24, top: 24, width: 34 }} />
        <div style={{ background: "#e3412f", bottom: 24, height: 34, position: "absolute", right: 24, width: 34 }} />
        <div style={{ background: "#f2d84b", bottom: 24, height: 34, left: 24, position: "absolute", width: 34 }} />
        <div
          style={{
            border: "8px solid #eff7e8",
            height: 92,
            left: 44,
            position: "absolute",
            top: 44,
            transform: "rotate(45deg)",
            width: 92,
          }}
        />
        <span style={{ position: "relative" }}>MP</span>
      </div>
    ),
    size,
  );
}
