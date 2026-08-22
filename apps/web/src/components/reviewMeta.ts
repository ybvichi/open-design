/**
 * 历史评审列表 / 详情 Modal 共享的小工具。
 *
 * 从 `ReviewListModal` 抽出，避免详情弹窗复制一份同款取值/格式化逻辑。
 * 纯函数、无 React 依赖，两端都 import。
 */

/** 取值：缺失时回退为 fallback，再不行给「—」。0 视为有效值（保留）。 */
export function pick(...vals: any[]): string {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '—';
}

/** 把「已完成 / 评审中」这类计数格式化为 `X / Y`；缺总数时只显示 X。 */
export function withTotal(count: string, total: string): string {
  if (count === '—') return '—';
  if (total === '—') return count;
  return `${count} / ${total}`;
}

/** 由截止时间算剩余整天数。优先用 ISO 串 `preReviewEndTimeDate`，
 *  缺失再回退 `preReviewEndTime`（"2024/12/04 23:59:59"）。解析失败返回 null。 */
export function computeRemainDays(iso?: unknown, fallback?: unknown): number | null {
  const s = typeof iso === 'string' && iso ? iso : typeof fallback === 'string' ? fallback : null;
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

/**
 * 评审类型 → 头像首字 + 背景色，显示在创建人前。
 *
 * reviewType 取值（对齐 `apps/daemon/src/routes/hik_routes/uedro.ts` 注释）：
 *   "1"  交互评审 → 交（橙）
 *   "2"  视觉评审 → 视（红）
 *   "3"  文稿评审 → 文（青）
 *   "4"  表格评审 → 表（绿）
 *   "5"  海客评审 → 海（随机深色）
 *   "10" 插件评审 → 插（随机深色）
 *   "11" Pixso Handoff → P（首字母大写，随机深色）
 *
 * 随机深色按 reviewNum 稳定哈希取色，避免 React 重渲染时颜色抖动。
 * 无法识别的 reviewType 返回 null（不渲染头像）。
 */
export const REVIEW_TYPE_META: Record<string, { char: string; color: string }> = {
  '1': { char: '交', color: 'rgb(237, 183, 64)' },
  '2': { char: '视', color: 'rgb(245, 107, 110)' },
  '3': { char: '文', color: 'rgb(21, 188, 216)' },
  '4': { char: '表', color: 'rgb(92, 214, 92)' },
  '5': { char: '海', color: 'rgb(120, 60, 160)' },
  '10': { char: '插', color: 'rgb(90, 110, 180)' },
  '11': { char: 'P', color: 'rgb(60, 130, 140)' },
};

export function reviewTypeMeta(r: any): { char: string; color: string } | null {
  const t = r?.reviewType;
  if (t === undefined || t === null || t === '') return null;
  const key = String(t);
  const base = REVIEW_TYPE_META[key];
  if (base) return base;
  // 未知类型：用稳定哈希取一个深色，首字取 reviewType 串首字符。
  return { char: key.charAt(0).toUpperCase() || '?', color: darkColorFrom(r) };
}

/** 由评审标识稳定派生一个深色（HSL，亮度 38%），用于海客/插件/Pixso 等随机色类型。 */
export function darkColorFrom(r: any): string {
  const seed = String(r?.reviewNum ?? r?.id ?? r?.reviewName ?? Math.random());
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 38%)`;
}

/** 评审类型 → 中文标签（用于详情头部副标题）。未识别回退「其它」。 */
const REVIEW_TYPE_LABEL: Record<string, string> = {
  '1': '交互评审',
  '2': '视觉评审',
  '3': '文稿评审',
  '4': '表格评审',
  '5': '海客评审',
  '10': '插件评审',
  '11': 'Pixso Handoff',
};

export function reviewTypeLabel(r: any): string {
  const t = r?.reviewType;
  if (t === undefined || t === null || t === '') return '—';
  return REVIEW_TYPE_LABEL[String(t)] ?? '其它';
}
