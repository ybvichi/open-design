import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ReviewListModal.module.css';
import { pick, computeRemainDays, withTotal, reviewTypeMeta } from './reviewMeta';
import { ReviewDetailDrawer } from './ReviewDetailModal';

/** 卡片「更多」下拉的操作。评审详情为第一项（打开右侧抽屉，非异步操作），
 *  其余三项对齐羽点原站卡片左下角的子功能菜单。 */
type CardAction = 'detail' | 'download' | 'remind' | 'notify';

/** 单卡片操作状态：当前展开的下拉、各项的 pending / 结果反馈。 */
interface CardActionState {
  open: boolean;
  pending: CardAction | null;
  // 成功 / 失败提示文案，null = 无提示。展示 2.5s 后自动清除。
  toast: { text: string; tone: 'ok' | 'err' } | null;
  // 「开启通知」需要反映当前订阅态：原站按 subscriptionStatus 字段渲染开关。
  notifyOn: boolean;
}

/**
 * 历史评审 Modal：列出羽点（uedro）的评审列表。
 *
 * 数据来自后端 `POST /api/hik/uedro/reviewList`（透传羽点上游 reviewList），
 * 请求体字段与 `apps/daemon/src/routes/hik_routes/uedro.ts` 对齐。未登录或
 * 会话失效时后端返回 401，这里展示错误。
 *
 * 列表区顶部筛选栏：
 *   左侧 processType 单选切换（评审中/我参与的/我发起的/全部）
 *   右侧 reviewType 下拉 + reviewName 搜索框（300ms 防抖）
 * 任一筛选条件变化都重置到第 1 页重新拉取。
 *
 * 「评审详情」是卡片「更多」下拉的第一项，打开右侧抽屉（ReviewDetailDrawer），
 * 抽屉叠加在列表画框之上，从右边缘滑入；关闭即回到列表。
 *
 * 宽高弹性固定为视口 80%（加载/错误/空态共用同一画框）；卡片网格布局，
 * 底部翻页（上一页 / 下一页，按返回条数判断是否还有后续页）。
 */
const PAGE_SIZE = 9;

/** processType 选项（对齐 uedro.ts 注释）。 */
const PROCESS_TYPES: { value: number; label: string }[] = [
  { value: 0, label: '评审中' },
  { value: 1, label: '我参与的' },
  { value: 2, label: '我发起的' },
  { value: 3, label: '全部' },
];

/** reviewType 选项（对齐 REVIEW_TYPE_META + uedro.ts 注释）。空串 = 全部。 */
const REVIEW_TYPES: { value: string; label: string }[] = [
  { value: '', label: '全部类型' },
  { value: '1', label: '交互评审' },
  { value: '2', label: '视觉评审' },
  { value: '3', label: '文稿评审' },
  { value: '5', label: '海客评审' },
  { value: '10', label: '插件评审' },
  { value: '11', label: 'Pixso-Handoff' },
];

export function ReviewListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  // 本页返回条数 < PAGE_SIZE 视为已到末页（上游未提供 total 字段）。
  const [reachedEnd, setReachedEnd] = useState(false);

  // 筛选条件：processType / reviewType / reviewName（搜索框）。
  const [processType, setProcessType] = useState(0);
  const [reviewType, setReviewType] = useState('');
  const [reviewName, setReviewName] = useState('');
  // 防抖后的搜索词——真正的请求用这个值，输入框用 reviewName 即时响应。
  const [debouncedName, setDebouncedName] = useState('');

  // 评审详情抽屉：叠加在列表画框之上，由卡片「更多」→「评审详情」触发。
  const [detailReview, setDetailReview] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 弹窗关闭 / 组件卸载后不再写状态，避免异步回填到已卸载组件。
  const aliveRef = useRef(true);
  // 最新一次请求的序号，丢弃过期响应（筛选快速切换时旧响应可能晚到）。
  const reqIdRef = useRef(0);

  // 搜索框 300ms 防抖：把 reviewName 同步到 debouncedName。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(reviewName), 300);
    return () => clearTimeout(t);
  }, [reviewName]);

  /** 拉取一页评审列表。仅做请求与解析，不写状态——状态由调用方写入，
   *  这样首屏加载、翻页、筛选切换都能在 aliveRef 失效时安全跳过回填。 */
  async function fetchPage(
    pageNo: number,
    filters: { processType: number; reviewType: string; reviewName: string },
  ): Promise<{ list: any[]; reachedEnd: boolean }> {
    const resp = await fetch('/api/hik/uedro/reviewList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewName: filters.reviewName,
        processType: filters.processType,
        reviewModel: 0,
        reviewType: filters.reviewType || null,
        pageSize: PAGE_SIZE,
        pageNo,
        total: 0,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.ok) throw new Error('reviewList failed');
    const list = Array.isArray(json?.data) ? json.data : [];
    return { list, reachedEnd: list.length < PAGE_SIZE };
  }

  // 翻页 / 首屏加载统一入口：拉取指定页码并归一写入列表状态。
  // 用闭包捕获的 filters 保证请求参数与写入时机一致。
  async function loadPage(
    pageNo: number,
    filters: { processType: number; reviewType: string; reviewName: string },
  ) {
    if (pageNo < 1) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setPage(pageNo);
    try {
      const { list, reachedEnd } = await fetchPage(pageNo, filters);
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setItems(list);
      setReachedEnd(reachedEnd);
    } catch (err: any) {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setError('评审列表加载失败: ' + (err?.message || String(err)));
      setItems([]);
      setReachedEnd(true);
    } finally {
      if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
    }
  }

  // 打开时 / 筛选条件变化时，重置到第 1 页重新拉取。
  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    const filters = { processType, reviewType, reviewName: debouncedName };
    void loadPage(1, filters);
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processType, reviewType, debouncedName]);

  // 单纯翻页（不重置筛选）。
  function gotoPage(pageNo: number) {
    void loadPage(pageNo, { processType, reviewType, reviewName: debouncedName });
  }

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.shell} role="dialog" aria-modal="true">
        <div className={styles.head}>
          <div className={styles.kicker}>REVIEW</div>
          <h2 className={styles.title}>历史评审</h2>
          <p className={styles.subtitle}>来自羽点（uedro）的评审列表</p>
        </div>
        {/* 筛选栏：左侧 processType 单选切换，右侧 reviewType 下拉 + 搜索框。 */}
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="评审范围">
            {PROCESS_TYPES.map((pt) => (
              <button
                key={pt.value}
                type="button"
                role="tab"
                aria-selected={processType === pt.value}
                className={`${styles.tab} ${processType === pt.value ? styles.tabActive : ''}`}
                onClick={() => setProcessType(pt.value)}
              >
                {pt.label}
              </button>
            ))}
          </div>
          <div className={styles.filters}>
            <select
              className={styles.select}
              value={reviewType}
              onChange={(e) => setReviewType(e.target.value)}
              aria-label="按评审类型过滤"
            >
              {REVIEW_TYPES.map((rt) => (
                <option key={rt.value || 'all'} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              className={styles.search}
              placeholder="搜索评审名称"
              value={reviewName}
              onChange={(e) => setReviewName(e.target.value)}
              aria-label="按评审名称搜索"
            />
          </div>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.stateWrap}>
              <div className={styles.spinner} />
              <span>加载中…</span>
            </div>
          ) : error ? (
            <div className={styles.stateWrap}>
              <span className={styles.errorText}>{error}</span>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateWrap}>
              <span>暂无评审</span>
            </div>
          ) : (
            <div className={styles.grid}>
              {items.map((r: any, i: number) => (
                <ReviewCard
                  key={r?.reviewNum ?? r?.id ?? i}
                  r={r}
                  onOpenDetail={(review) => {
                    setDetailReview(review);
                    setDetailOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.foot}>
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => gotoPage(1)}
              disabled={loading || page <= 1}
              aria-label="第一页"
            >
              «
            </button>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => gotoPage(page - 1)}
              disabled={loading || page <= 1}
              aria-label="上一页"
            >
              ‹
            </button>
            <div className={styles.pageNums}>
              {renderPageNumbers(page, reachedEnd, loading, gotoPage)}
            </div>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => gotoPage(page + 1)}
              disabled={loading || reachedEnd}
              aria-label="下一页"
            >
              ›
            </button>
            <button
              type="button"
              className={styles.pagerBtn}
              onClick={() => gotoPage(1)}
              disabled={loading || reachedEnd}
              aria-label="末页"
              title="末页（未知总数）"
            >
              »
            </button>
            <span className={styles.pageJump}>
              <span className={styles.pageJumpLabel}>第</span>
              <input
                type="number"
                className={styles.pageInput}
                min={1}
                value={page}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n) && n >= 1) gotoPage(n);
                }}
                aria-label="跳转到指定页"
              />
              <span className={styles.pageJumpLabel}>页</span>
            </span>
          </div>
          <button type="button" className={styles.pagerBtn} onClick={onClose}>
            关闭
          </button>
        </div>
        <ReviewDetailDrawer
          review={detailReview}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * 渲染页码按钮序列：当前页左右各展开若干页，超出用省略号收口。
 *
 * 因为上游 reviewList 不返回 total，无法知道确切末页——`reachedEnd`
 * 仅标识「当前是最后一页」，所以末页侧始终保留一个省略号占位，不渲染
 * 具体末页码。当前页接近第 1 页时左侧不显示省略号。
 *
 * @param current 当前页码（1-based）
 * @param reachedEnd 是否到达末页（本页返回 < PAGE_SIZE）
 * @param loading 是否加载中（loading 时禁用所有页码按钮）
 * @param gotoPage 跳页回调
 */
const PAGE_SIBLINGS = 2; // 当前页左右各显示几个页码

function renderPageNumbers(
  current: number,
  reachedEnd: boolean,
  loading: boolean,
  gotoPage: (n: number) => void,
): ReactNode {
  const nodes: ReactNode[] = [];
  // 起始页码：当前页左侧展开 SIBLINGS 个，但不小于 1。
  const start = Math.max(1, current - PAGE_SIBLINGS);
  // 结束页码：当前页右侧展开 SIBLINGS 个。因为不知道末页，右侧始终多留一个，
  // 让用户看到「后面还有」的预期——reachedEnd 时才不延伸。
  const end = reachedEnd ? current : current + PAGE_SIBLINGS;

  // 左侧省略号 + 第 1 页：当前页离第 1 页够远时显示。
  if (start > 1) {
    nodes.push(
      <button
        key="p1"
        type="button"
        className={styles.pageNum}
        onClick={() => gotoPage(1)}
        disabled={loading}
      >
        1
      </button>,
    );
    if (start > 2) {
      nodes.push(
        <span key="left-ellipsis" className={styles.pageEllipsis} aria-hidden>
          …
        </span>,
      );
    }
  }

  // 中间连续页码区。
  for (let p = start; p <= end; p++) {
    nodes.push(
      <button
        key={`p${p}`}
        type="button"
        className={`${styles.pageNum} ${p === current ? styles.pageNumActive : ''}`}
        onClick={() => gotoPage(p)}
        disabled={loading || p === current}
        aria-current={p === current ? 'page' : undefined}
      >
        {p}
      </button>,
    );
  }

  // 右侧省略号：未到末页时显示，提示后面还有更多页。
  if (!reachedEnd) {
    nodes.push(
      <span key="right-ellipsis" className={styles.pageEllipsis} aria-hidden>
        …
      </span>,
    );
  }

  return nodes;
}

/** 评审卡片：一个评审项 = 一张卡片，分层展示核心字段。
 *
 * 字段映射对齐羽点上游 reviewList 透传结构（见真实响应）：
 *   创建人        creator
 *   主标题        projectName → manuscriptDtos[0].fileName（即 xlsx/docx 文件名）
 *   评审名称      reviewName
 *   核心评委评审率 coreReviewerRatePercent（上游已是 "0%" / "100.00%" 百分比串）
 *   创建时间      createTime          "2024/12/02 10:29:55"
 *   结束时间      preReviewEndTime     "2024/12/04 23:59:59"
 *   已完成        finishReviewResNum   （分母取 repeat.reviewersNum = 评委人数）
 *   评审中        reviewingNum         （分母同上）
 *   缺陷数量      defectsNum           （缺失回退 manuscriptDtos[0].defectNums）
 *   剩余天数      由 preReviewEndTimeDate 计算，已过期 clamp 到 0（"剩余 0 天"）
 *
 * 示对照（第一条）：王欢44 · 剩余 0 天 · ...xlsx · 评审率 0% · 4/7 · 1/7 · 缺陷 0。
 * 注意：分母是 repeat.reviewersNum（7），不是 reviewAllNum（8）——示例明确为 /7。 */
function ReviewCard({ r, onOpenDetail }: { r: any; onOpenDetail: (review: any) => void }) {
  // 主标题：优先项目名，缺失则取首个稿件文件名（即示例中的 xlsx 文件名），再退到评审名称。
  const manuscriptFile = r?.manuscriptDtos?.[0]?.fileName;
  const title = pick(r?.projectName, manuscriptFile, r?.reviewName);
  const creator = pick(r?.creator, r?.creatorName);
  const reviewName = pick(r?.reviewName, r?.name);

  // 评审率：上游直接给百分比字符串。
  const coreRate = pick(r?.coreReviewerRatePercent, r?.coreReviewerRate, r?.reviewRate);

  // 已完成 / 评审中 / 总数：分母取 repeat.reviewersNum（评委人数），与「4 / 7」「1 / 7」对齐。
  const total = pick(r?.repeat?.reviewersNum, r?.reviewersNum);
  const finished = pick(r?.finishReviewResNum, r?.finishedCount);
  const reviewing = pick(r?.reviewingNum, r?.reviewingCount);
  const finishedLabel = withTotal(finished, total);
  const reviewingLabel = withTotal(reviewing, total);

  // 缺陷数量：上游 defectsNum，缺失回退稿件 defectNums。
  const defects = pick(r?.defectsNum, r?.manuscriptDtos?.[0]?.defectNums, r?.defectNum, r?.defectCount);

  // 剩余天数：由截止时间计算，已过期 clamp 到 0，并标红（urgent）。
  const remainDays = computeRemainDays(r?.preReviewEndTimeDate, r?.preReviewEndTime);
  const urgent = remainDays === null ? false : remainDays <= 0;
  const remainLabel = remainDays === null ? '—' : `剩余 ${Math.max(0, remainDays)} 天`;

  // 评审类型头像：圆形首字 + 类型色，显示在创建人前。
  const typeMeta = reviewTypeMeta(r);

  // 「更多」下拉菜单 + 三项操作（下载资源 / 一键提醒 / 开启通知）。
  const [menu, setMenu] = useState<CardActionState>({
    open: false,
    pending: null,
    toast: null,
    // subscriptionStatus 上游是字符串 "false"/"true"；缺失视为关。
    notifyOn: String(r?.subscriptionStatus) === 'true',
  });
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 点卡片外部收起下拉。
  useEffect(() => {
    if (!menu.open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu((m) => ({ ...m, open: false }));
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menu.open]);

  // toast 展示 2.5s 后自动清除，避免状态残留。
  useEffect(() => {
    if (!menu.toast) return;
    const t = setTimeout(() => setMenu((m) => ({ ...m, toast: null })), 2500);
    return () => clearTimeout(t);
  }, [menu.toast]);

  const reviewId = pick(r?.reviewId, r?.id);
  const manuscriptId = r?.manuscriptDtos?.[0]?.manuscriptId;
  const hasManuscript = Boolean(manuscriptId);

  /** 统一发起一项卡片操作：置 pending、调路由、回写 toast。 */
  async function runAction(action: CardAction) {
    setMenu((m) => ({ ...m, open: false, pending: action, toast: null }));
    try {
      if (action === 'download') {
        if (!manuscriptId) throw new Error('无稿件可下载');
        // 下载是二进制流：fetch 拿 blob，从 content-disposition 或稿件文件名取下载名。
        const resp = await fetch(
          `/api/hik/uedro/downloadManuscript?manuscriptId=${encodeURIComponent(manuscriptId)}`,
        );
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}${txt ? `: ${txt}` : ''}`);
        }
        const ctype = resp.headers.get('content-type') || '';
        if (ctype.includes('application/json')) {
          // 上游 JSON 错误体（鉴权失效 / 稿件不存在）。
          const j = await resp.json().catch(() => null);
          throw new Error(j?.error?.message || '下载失败');
        }
        const blob = await resp.blob();
        // 文件名：优先 content-disposition，退到稿件 fileName，再退 reviewName。
        const cd = resp.headers.get('content-disposition') || '';
        const cdName = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1];
        const fname = decodeURIComponent(cdName || manuscriptFile || `${reviewName || 'manuscript'}.bin`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setMenu((m) => ({ ...m, pending: null, toast: { text: '下载已开始', tone: 'ok' } }));
        return;
      }

      if (action === 'remind') {
        if (!reviewId || reviewId === '—') throw new Error('缺少 reviewId');
        const resp = await fetch('/api/hik/uedro/urge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewId }),
        });
        const j = await resp.json().catch(() => null);
        if (!resp.ok || !j?.ok) throw new Error(j?.error?.message || j?.msg || `HTTP ${resp.status}`);
        setMenu((m) => ({ ...m, pending: null, toast: { text: '已发送催办提醒', tone: 'ok' } }));
        return;
      }

      // notify：切换订阅态。原站 editSubscriptionStatus 用 status=true/false。
      const nextOn = !menu.notifyOn;
      if (!reviewId || reviewId === '—') throw new Error('缺少 reviewId');
      const resp = await fetch('/api/hik/uedro/editSubscriptionStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, status: nextOn }),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok || !j?.ok) throw new Error(j?.error?.message || j?.msg || `HTTP ${resp.status}`);
      setMenu((m) => ({
        ...m,
        pending: null,
        notifyOn: nextOn,
        toast: { text: nextOn ? '已开启通知' : '已关闭通知', tone: 'ok' },
      }));
    } catch (err: any) {
      setMenu((m) => ({
        ...m,
        pending: null,
        toast: { text: (err?.message || String(err)).slice(0, 80), tone: 'err' },
      }));
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.creator}>
          {typeMeta ? (
            <span className={styles.typeAvatar} style={{ background: typeMeta.color }} aria-hidden>
              {typeMeta.char}
            </span>
          ) : null}
          <span className={styles.creatorText}>{creator}</span>
        </span>
        {remainLabel !== '—' ? (
          <span className={`${styles.remainBadge} ${urgent ? styles.urgent : ''}`}>{remainLabel}</span>
        ) : null}
      </div>

      <div className={styles.cardTitle}>{title}</div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>评审名称：</div>
          <div className={styles.fieldValue}>{reviewName}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>核心评委评审率：</div>
          <div className={styles.fieldValue} style={{color:'red'}}>{coreRate}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>创建时间：</div>
          <div className={styles.fieldValue}>{pick(r?.createTime, r?.createdAt, r?.createDate)}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>结束时间：</div>
          <div className={styles.fieldValue}>{pick(r?.preReviewEndTime, r?.endTime, r?.deadline, r?.expireTime)}</div>
        </div>
        <div className={styles.statsRow}>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>已完成：</div>
            <div className={styles.fieldValue}>{finishedLabel}</div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>评审中：</div>
            <div className={styles.fieldValue}>{reviewingLabel}</div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>缺陷数量：</div>
            <div className={styles.fieldValue}>{defects}</div>
          </div>
        </div>
      </div>

      <div className={styles.cardFoot}>
        {/* 卡片左下角「更多」下拉：评审详情（首位） / 下载资源 / 一键提醒 / 开启通知。 */}
        <div className={styles.moreWrap} ref={menuRef}>
          <button
            type="button"
            className={`${styles.moreBtn} ${menu.open ? styles.moreBtnActive : ''}`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={() => setMenu((m) => ({ ...m, open: !m.open }))}
          >
            更多
            <span className={styles.moreCaret} aria-hidden>▾</span>
          </button>
          {menu.open ? (
            <div className={styles.moreMenu} role="menu">
              {/* 评审详情：打开右侧抽屉，非异步，故不走 runAction。 */}
              <button
                type="button"
                role="menuitem"
                className={styles.moreItem}
                onClick={() => {
                  setMenu((m) => ({ ...m, open: false }));
                  onOpenDetail(r);
                }}
                title="查看评审详情"
              >
                评审详情
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.moreItem}
                disabled={!hasManuscript || menu.pending === 'download'}
                onClick={() => void runAction('download')}
                title={hasManuscript ? '下载稿件资源' : '该评审无稿件资源'}
              >
                {menu.pending === 'download' ? '下载中…' : '下载资源'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.moreItem}
                disabled={menu.pending === 'remind'}
                onClick={() => void runAction('remind')}
              >
                {menu.pending === 'remind' ? '发送中…' : '一键提醒'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${styles.moreItem} ${menu.notifyOn ? styles.moreItemOn : ''}`}
                disabled={menu.pending === 'notify'}
                onClick={() => void runAction('notify')}
              >
                {menu.pending === 'notify' ? '切换中…' : menu.notifyOn ? '关闭通知' : '开启通知'}
              </button>
            </div>
          ) : null}
          {menu.toast ? (
            <span className={`${styles.actionToast} ${menu.toast.tone === 'err' ? styles.actionToastErr : ''}`}>
              {menu.toast.text}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
