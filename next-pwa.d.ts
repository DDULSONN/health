declare module "next-pwa" {
  type RuntimeCachingEntry = {
    urlPattern: RegExp;
    handler: "CacheFirst" | "CacheOnly" | "NetworkFirst" | "NetworkOnly" | "StaleWhileRevalidate";
    options?: {
      cacheName?: string;
      expiration?: {
        maxEntries?: number;
        maxAgeSeconds?: number;
      };
    };
  };

  type PWAOptions = {
    dest: string;
    register?: boolean;
    skipWaiting?: boolean;
    disable?: boolean;
    runtimeCaching?: RuntimeCachingEntry[];
  };

  export default function withPWAInit(options: PWAOptions): <T>(config: T) => T;
}

