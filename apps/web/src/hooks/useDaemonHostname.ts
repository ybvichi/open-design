import { useState, useEffect } from 'react';

let cachedHostname: string | null = null;
let hostnamePromise: Promise<string | null> | null = null;

async function loadDaemonHostname(): Promise<string | null> {
  if (cachedHostname) return cachedHostname;
  if (!hostnamePromise) {
    hostnamePromise = (async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) return null;
        const body = (await res.json()) as { hostname?: string };
        const next = body?.hostname ?? null;
        if (next) cachedHostname = next;
        return next;
      } catch {
        return null;
      } finally {
        if (!cachedHostname) hostnamePromise = null;
      }
    })();
  }
  return hostnamePromise;
}

export function useDaemonHostname(): string | null {
  const [hostname, setHostname] = useState<string | null>(cachedHostname);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadDaemonHostname();
      if (!cancelled) setHostname(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return hostname;
}
