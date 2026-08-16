// The web sidecar must stay loopback-only for every surface except the project
// raw-file endpoint (/api/projects/:id/raw/<file>), which stays reachable from
// the computer name or a private LAN IP so generated files can be fetched by
// other devices on the network.
//
// These negative examples read the machine's real hostname and IPv4 addresses
// from node:os instead of hardcoding them, then assert that every non-raw
// surface is rejected when addressed through that hostname / IP.

import http from 'node:http';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createDaemonProxyHandler } from '../sidecar/server';

function rawRequest(
  port: number,
  path: string,
  host: string,
  method = 'GET',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { host },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Read the machine's own network identities: its hostname plus every
 * non-internal IPv4 address. These are the exact values an attacker (or a
 * legitimate LAN peer) would use in the Host header to reach the sidecar.
 */
function readLocalHostIdentities(): string[] {
  const hosts = new Set<string>();
  try {
    const hostname = os.hostname();
    if (hostname) hosts.add(hostname);
  } catch {
    // os.hostname() can throw in some environments; fall through
  }
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        const isIpv4 = entry.family === 'IPv4';
        if (isIpv4 && !entry.internal) hosts.add(entry.address);
      }
    }
  } catch {
    // networkInterfaces() can throw in some environments; fall through
  }
  // Deterministic fallback so the negative examples still exercise the guard
  // even when the machine exposes no hostname / LAN IPv4.
  if (hosts.size === 0) hosts.add('192.168.1.5');
  return [...hosts];
}

const localHosts = readLocalHostIdentities();

let proxy: HttpServer | undefined;
let proxyPort = 0;

afterEach(async () => {
  if (proxy == null) return;
  await new Promise<void>((resolve) => proxy!.close(() => resolve()));
  proxy.closeAllConnections?.();
  proxy = undefined;
});

async function startProxy(): Promise<number> {
  proxy = createHttpServer(
    createDaemonProxyHandler(null, async (_request, response) => {
      response.statusCode = 200;
      response.end('fallback-ok');
    }),
  );
  await new Promise<void>((resolve) => proxy!.listen(0, '127.0.0.1', () => resolve()));
  proxyPort = (proxy!.address() as AddressInfo).port;
  return proxyPort;
}

describe('sidecar host guard: loopback stays fully open', () => {
  it('serves the SPA fallback on strict loopback hosts', async () => {
    const port = await startProxy();
    const res = await rawRequest(port, '/', `127.0.0.1:${port}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('fallback-ok');
  });

  it('serves non-raw API routes on strict loopback hosts', async () => {
    const port = await startProxy();
    const res = await rawRequest(port, '/api/health', `127.0.0.1:${port}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('fallback-ok');
  });
});

describe('sidecar host guard: negative examples read from hostname and IP', () => {
  for (const host of localHosts) {
    describe(`Host header = ${host}`, () => {
      it('blocks the SPA', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/', `${host}:${port}`);
        expect(res.status).toBe(403);
      });

      it('blocks non-raw API routes', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/api/health', `${host}:${port}`);
        expect(res.status).toBe(403);
      });

      it('blocks the library raw route', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/api/library/assets/a1/raw', `${host}:${port}`);
        expect(res.status).toBe(403);
      });

      it('blocks non-raw project file routes', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/api/projects/p1/files/index.html', `${host}:${port}`);
        expect(res.status).toBe(403);
      });

      it('blocks a raw directory path without a file extension', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/api/projects/p1/raw/site', `${host}:${port}`);
        expect(res.status).toBe(403);
      });

      it('blocks non-GET methods on the raw endpoint', async () => {
        const port = await startProxy();
        const res = await rawRequest(
          port,
          '/api/projects/p1/raw/index.html',
          `${host}:${port}`,
          'DELETE',
        );
        expect(res.status).toBe(403);
      });

      it('allows the project raw-file endpoint', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/api/projects/p1/raw/index.html', `${host}:${port}`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('fallback-ok');
      });

      it('allows nested project raw files with an extension', async () => {
        const port = await startProxy();
        const res = await rawRequest(port, '/api/projects/p1/raw/site/index.html', `${host}:${port}`);
        expect(res.status).toBe(200);
      });
    });
  }
});
