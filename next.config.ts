import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";
import withPWAInit from "next-pwa";

const __projectDir = path.dirname(fileURLToPath(import.meta.url));
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      urlPattern: /^https?.*\/_next\/static\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        },
      },
    },
    {
      urlPattern: /^https?.*\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|woff2)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-media",
        expiration: {
          maxEntries: 80,
          maxAgeSeconds: 60 * 60 * 24 * 7,
        },
      },
    },
    {
      // 앱 페이지는 오프라인 진입 가능하도록 최소 캐시, API/관리자/인증 경로는 제외
      urlPattern:
        /^https?:\/\/[^/]+\/(?!api\/|admin(?:\/|$)|login(?:\/|$)|mypage(?:\/|$)|community(?:\/|$)|dating(?:\/|$)|certify(?:\/|$)|bodybattle(?:\/|$)|notifications(?:\/|$)).*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "pages-network-first",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 60 * 60 * 24,
        },
      },
    },
  ],
});

const nextConfig: NextConfig = {
  turbopack: {
    root: __projectDir,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=()",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/protein",
        destination: "/snacks",
        permanent: true,
      },
    ];
  },
};

export default withPWA(nextConfig);
