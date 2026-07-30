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
          background: "#07110b",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <svg height="64" viewBox="0 0 64 64" width="64">
          <defs>
            <filter colorInterpolationFilters="sRGB" height="160%" id="neonGlow" width="160%" x="-30%" y="-30%">
              <feGaussianBlur in="SourceGraphic" result="wide" stdDeviation="4" />
              <feGaussianBlur in="SourceGraphic" result="tight" stdDeviation="1.5" />
              <feMerge>
                <feMergeNode in="wide" />
                <feMergeNode in="tight" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="arrowFace" x1="32" x2="32" y1="11" y2="48">
              <stop offset="0" stopColor="#f4ff33" />
              <stop offset="0.42" stopColor="#88ff21" />
              <stop offset="1" stopColor="#18e85a" />
            </linearGradient>
          </defs>
          <path d="M32 7 L56 31 L44 31 L44 43 L32 55 L20 43 L20 31 L8 31 Z" fill="#dfff28" filter="url(#neonGlow)" opacity="0.82" />
          <path d="M32 7 L56 31 L44 31 L44 43 L32 55 L20 43 L20 31 L8 31 Z" fill="#06130d" />
          <path d="M32 12 L50 30 L39 30 L39 40 L32 47 L25 40 L25 30 L14 30 Z" fill="url(#arrowFace)" />
          <path d="M32 15 L46 29 L39 29 L32 22 L25 29 L18 29 Z" fill="#f6ff98" opacity="0.78" />
        </svg>
      </div>
    ),
    size,
  );
}
