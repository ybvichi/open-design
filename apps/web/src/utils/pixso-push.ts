import { partialHtmlToIframeWeb } from './formatDsl';

export type PixsoPushStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Push an HTML artifact to the local Pixso AI Builder Dev plugin.
 *
 * The daemon's sidecar starts a local WebSocket bridge on ws://127.0.0.1:9528
 * (apps/daemon/src/ws-server-startup.ts). This helper converts the current
 * HTML document into the Pixso-renderable DSL via `partialHtmlToIframeWeb`
 * and relays it over that bridge.
 */
export function pushHtmlToPixso(
  html: string,
  options: { isSplit?: boolean; onStatus?: (status: PixsoPushStatus) => void } = {},
): void {
  const { isSplit = false, onStatus } = options;
  let content = html || '';
  if (!content.includes('<head>') && !content.includes('<HEAD>')) {
    onStatus?.('error');
    return;
  }
  onStatus?.('loading');
  let ws: WebSocket | null = null;
  let dismissed = false;
  try {
    ws = new WebSocket('ws://127.0.0.1:9528');
    ws.onopen = () => {
      if (dismissed) return;
      if (isSplit) {
        const splitScript = '<script>window.__mcp__use__sub__pages=true</script>';
        content = content
          .replace('<head>', `<head>${splitScript}`)
          .replace('<HEAD>', `<HEAD>${splitScript}`);
      }
      partialHtmlToIframeWeb(content, (dslData: unknown) => {
        ws?.send(JSON.stringify(dslData));
        ws?.close();
      });
      onStatus?.('success');
    };
    ws.onerror = () => {
      ws?.close();
    };
    ws.onclose = () => {
      ws = null;
    };
  } catch {
    onStatus?.('error');
    ws = null;
  }
}
