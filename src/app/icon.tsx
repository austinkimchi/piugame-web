import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#10130f",
          border: "4px solid #eff7e8",
          color: "#eff7e8",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          fontSize: 24,
          fontWeight: 900,
          height: "100%",
          justifyContent: "center",
          letterSpacing: 0,
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#28c950",
            height: 12,
            left: 8,
            position: "absolute",
            top: 8,
            width: 12,
          }}
        />
        <div
          style={{
            background: "#e3412f",
            bottom: 8,
            height: 12,
            position: "absolute",
            right: 8,
            width: 12,
          }}
        />
        <div
          style={{
            border: "3px solid #eff7e8",
            height: 32,
            left: 16,
            position: "absolute",
            top: 16,
            transform: "rotate(45deg)",
            width: 32,
          }}
        />
        <span style={{ position: "relative" }}>MP</span>
      </div>
    ),
    size,
  );
}
