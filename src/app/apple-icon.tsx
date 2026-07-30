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
          background: "#07110b",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <svg height="180" viewBox="0 0 180 180" width="180">
          <defs>
            <filter colorInterpolationFilters="sRGB" height="170%" id="neonGlow" width="170%" x="-35%" y="-35%">
              <feGaussianBlur in="SourceGraphic" result="wide" stdDeviation="11" />
              <feGaussianBlur in="SourceGraphic" result="tight" stdDeviation="4" />
              <feMerge>
                <feMergeNode in="wide" />
                <feMergeNode in="tight" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="arrowFace" x1="90" x2="90" y1="31" y2="136">
              <stop offset="0" stopColor="#f4ff33" />
              <stop offset="0.42" stopColor="#88ff21" />
              <stop offset="1" stopColor="#18e85a" />
            </linearGradient>
          </defs>
          <path d="M90 20 L158 88 L124 88 L124 122 L90 156 L56 122 L56 88 L22 88 Z" fill="#dfff28" filter="url(#neonGlow)" opacity="0.84" />
          <path d="M90 20 L158 88 L124 88 L124 122 L90 156 L56 122 L56 88 L22 88 Z" fill="#06130d" />
          <path d="M90 35 L141 86 L110 86 L110 113 L90 133 L70 113 L70 86 L39 86 Z" fill="url(#arrowFace)" />
          <path d="M90 43 L130 83 L110 83 L90 63 L70 83 L50 83 Z" fill="#f6ff98" opacity="0.78" />
        </svg>
      </div>
    ),
    size,
  );
}
