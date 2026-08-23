// 工具脚本：把当前项目的 HTML 文件打包成标准 Axure RP HTML 交互稿压缩包。
// 1. fetchProjectFiles 拉文件列表；2. HTML 文件按目录结构生成页面树导航；
// 3. 取全部工程文件（文本 + 二进制）按原始目录结构放入 files/<path>，
//    保证 HTML 内 CSS/JS/图片等相对路径引用可正确解析；
// 4. fetch 拉取 /axure-prototype 骨架资源（含 Axure RP 运行时），以
//    data/document.js 为模板，用标记替换法注入生成的 PAGES 数组；
// 5. buildZip 生成 Blob，triggerDownload 下载。

import { buildZip, type ZipEntry } from './zip';
import { fetchProjectFiles, fetchProjectFileText, fetchProjectFileBase64 } from '../providers/registry';
import type { ProjectFile } from '../types';
import { safeFilename, triggerDownload } from './exports';
// 构建时生成的骨架文件清单（相对 axure-prototype/ 的路径列表）。
import skeletonManifest from '../../public/axure-prototype/skeleton-manifest.json';

interface AxurePageNode {
  id: string;
  pageName: string;
  type: string;
  url: string;
  children?: AxurePageNode[];
}

export interface AxureExportOptions {
  projectId: string;
  title?: string;
  onProgress?: (done: number, total: number) => void;
}

export type AxureExportResult =
  | { ok: true; pageCount: number }
  | { ok: false; error: string };

const HTML_FILE_EXTS = /\.html?$/i;
const TEXT_FILE_EXTS = /\.(html?|css|js|mjs|cjs|json|md|svg|xml|txt|csv|webmanifest|map)$/i;
// 骨架中按二进制处理的扩展名（图片、字体、光标等）。
const BINARY_FILE_EXTS = /\.(png|gif|ico|woff2?|cur|jpg|jpeg|webp|mp3|mp4|ttf|otf|eot)$/i;
const SKELETON_BASE = '/axure-prototype';

function pageIdFromPath(rawPath: string, used: Set<string>): string {
  const base =
    rawPath.replace(/\.html?$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'page';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function pageNameFromPath(rawPath: string): string {
  const fileName = rawPath.split('/').pop() ?? rawPath;
  const name = fileName.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim();
  if (!name) return rawPath;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isHtmlPage(file: ProjectFile): boolean {
  if (file.type === 'dir') return false;
  return HTML_FILE_EXTS.test(file.path || file.name);
}

function buildPageTree(
  htmlFiles: ProjectFile[],
  usedIds: Set<string>,
): { nodes: AxurePageNode[]; idByPath: Map<string, string> } {
  const idByPath = new Map<string, string>();
  type DirNode = { name: string; pages: AxurePageNode[]; dirs: Map<string, DirNode> };
  const root: DirNode = { name: '', pages: [], dirs: new Map() };
  function ensureDir(segments: string[]): DirNode {
    let current = root;
    for (const seg of segments) {
      let next = current.dirs.get(seg);
      if (!next) {
        next = { name: seg, pages: [], dirs: new Map() };
        current.dirs.set(seg, next);
      }
      current = next;
    }
    return current;
  }
  const sorted = [...htmlFiles].sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name));
  for (const file of sorted) {
    const p = file.path || file.name;
    const segments = p.split('/').filter(Boolean);
    segments.pop();
    const parent = segments.length ? ensureDir(segments) : root;
    const id = pageIdFromPath(p, usedIds);
    idByPath.set(p, id);
    parent.pages.push({ id, pageName: pageNameFromPath(p), type: 'Wireframe', url: `files/${p}` });
  }
  function collapse(dir: DirNode): AxurePageNode[] {
    const result: AxurePageNode[] = [];
    for (const page of dir.pages) result.push(page);
    for (const sub of dir.dirs.values()) {
      const subPages = collapse(sub);
      if (subPages.length === 0) continue;
      // Folder 节点使用空 id，避免与子页面 id 冲突导致 getPageUrlsById 误匹配。
      result.push({
        id: '',
        pageName: sub.name.charAt(0).toUpperCase() + sub.name.slice(1),
        type: 'Folder',
        url: '',
        children: subPages,
      });
    }
    return result;
  }
  return { nodes: collapse(root), idByPath };
}

// 把页面树序列化为 Axure RP document.js 中 PAGES 数组的 JS 源码。
// 输出格式与 generate-sitemap.ps1 的 NodesToJs 一致：每项占一行，
// 缩进随深度递增，叶子节点不输出 children 字段。
function buildPagesJs(items: AxurePageNode[], indent = 2): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const node = items[i]!;
    const comma = i < items.length - 1 ? ',' : '';
    const id = escapeJsString(node.id);
    const pageName = escapeJsString(node.pageName);
    const type = escapeJsString(node.type);
    const url = escapeJsString(node.url);
    if (node.children && node.children.length > 0) {
      const childJs = buildPagesJs(node.children, indent + 8);
      lines.push(`${pad}{ id: "${id}", pageName: "${pageName}", type: "${type}", url: "${url}", children: [`);
      lines.push(childJs);
      lines.push(`${pad}] }${comma}`);
    } else {
      lines.push(`${pad}{ id: "${id}", pageName: "${pageName}", type: "${type}", url: "${url}" }${comma}`);
    }
  }
  return lines.join('\n');
}

// document.js 模板使用标记注释圈定 PAGES 区域；导出时只替换该区域，
// 其余部分（样式表、配置等）保持原样。替换逻辑与 generate-sitemap.ps1 一致：
// 从 PAGES_MARKER_START 到 PAGES_MARKER_END 后第一个换行符全部替换。
const PAGES_MARKER_START = '// ===== PAGES START';
const PAGES_MARKER_END = '// ===== PAGES END =====';

// 模板中 projectName 的占位符；导出时替换为实际项目标题。
const PROJECT_NAME_PLACEHOLDER = '__AXURE_PROJECT_NAME__';

function injectPagesIntoDocument(template: string, pageNodes: AxurePageNode[], projectName: string): string {
  const startIdx = template.indexOf(PAGES_MARKER_START);
  const endIdx = template.indexOf(PAGES_MARKER_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    // 模板缺失标记时退化为把 PAGES 变量追加到末尾。
    const pagesJs = buildPagesJs(pageNodes);
    const fallback = `${template}\nvar PAGES = [\n${pagesJs}\n];\n`;
    return fallback.replaceAll(PROJECT_NAME_PLACEHOLDER, escapeJsString(projectName));
  }
  // 与 generate-sitemap.ps1 同样的策略：替换从 startIdx 到 endIdx 后第一个换行。
  const arrayEnd = template.indexOf('\n', endIdx);
  const blockEnd = arrayEnd < 0 ? template.length : arrayEnd;
  const pagesJs = buildPagesJs(pageNodes);
  const newBlock =
    `${PAGES_MARKER_START}\n` +
    `    var PAGES = [\n${pagesJs}\n    ];\n` +
    `    ${PAGES_MARKER_END}`;
  const replaced = template.slice(0, startIdx) + newBlock + template.slice(blockEnd);
  return replaced.replaceAll(PROJECT_NAME_PLACEHOLDER, escapeJsString(projectName));
}

async function fetchTextOrNull(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function fetchBinaryOrNull(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// 骨架中不打包进 ZIP 的开发产物：清单自身、构建脚本、README、示例 files。
function isSkeletonAsset(path: string): boolean {
  if (path === 'skeleton-manifest.json') return false;
  if (path === 'generate-sitemap.ps1') return false;
  if (path === 'README.md') return false;
  if (path.startsWith('files/')) return false; // 示例页面，用工程实际文件替换
  return true;
}

// 把 FileReader 产出的 data:...;base64,<data> 形式字符串解码为 Uint8Array。
// 返回 null 表示格式无效或解码失败，调用方据此跳过该文件。
function base64DataUrlToBytes(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const payload = dataUrl.slice(comma + 1);
  try {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function exportProjectAsAxureZip(opts: AxureExportOptions): Promise<AxureExportResult> {
  const { projectId, title } = opts;
  let files: ProjectFile[];
  try {
    files = await fetchProjectFiles(projectId);
  } catch (err) {
    return { ok: false, error: `拉取项目文件失败：${String(err)}` };
  }

  const htmlFiles = files.filter(isHtmlPage);
  if (htmlFiles.length === 0) {
    return { ok: false, error: '当前项目没有 HTML 文件，无法生成 Axure 交互稿。' };
  }

  const usedIds = new Set<string>();
  const { nodes: pageNodes, idByPath } = buildPageTree(htmlFiles, usedIds);
  const docName = title?.trim() || 'Axure RP HTML 交互稿';

  const entries: ZipEntry[] = [];

  // 拉取骨架全部资源（Axure RP 运行时 + CSS + 图片等）。
  const skeletonFiles = (skeletonManifest as string[]).filter(isSkeletonAsset);
  for (const rel of skeletonFiles) {
    const url = `${SKELETON_BASE}/${rel}`;
    if (BINARY_FILE_EXTS.test(rel)) {
      const bytes = await fetchBinaryOrNull(url);
      if (bytes) entries.push({ path: rel, content: bytes });
    } else {
      const content = await fetchTextOrNull(url);
      if (content != null) entries.push({ path: rel, content });
    }
  }

  // document.js 作为模板拉取后，用标记替换法注入生成的 PAGES 数组。
  const documentTemplate = await fetchTextOrNull(`${SKELETON_BASE}/data/document.js`);
  if (documentTemplate != null) {
    entries.push({ path: 'data/document.js', content: injectPagesIntoDocument(documentTemplate, pageNodes, docName) });
  }

  // 全部工程文件（非目录）按原始路径打包，确保相对路径引用可解析。
  const packableFiles = files.filter((f) => f.type !== 'dir');
  const total = packableFiles.length;
  let done = 0;
  for (const file of packableFiles) {
    const p = file.path || file.name;
    void idByPath; // 页面树节点的 url 字段已指向 files/<path>
    if (TEXT_FILE_EXTS.test(p) || file.mime.startsWith('text/')) {
      const content = await fetchProjectFileText(projectId, p);
      if (content != null) entries.push({ path: `files/${p}`, content });
    } else {
      const dataUrl = await fetchProjectFileBase64(projectId, p);
      const binary = base64DataUrlToBytes(dataUrl);
      if (binary) entries.push({ path: `files/${p}`, content: binary });
    }
    done += 1;
    opts.onProgress?.(done, total);
  }

  const blob = buildZip(entries);
  triggerDownload(blob, `${safeFilename(docName, 'axure-prototype')}.zip`);
  return { ok: true, pageCount: packableFiles.length };
}
