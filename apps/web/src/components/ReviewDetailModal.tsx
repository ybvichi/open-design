import { useEffect, useRef, useState } from 'react';
import styles from './ReviewDetailModal.module.css';
import {
  pick,
  computeRemainDays,
  reviewTypeMeta,
  reviewTypeLabel,
} from './reviewMeta';

/**
 * 评审详情右侧抽屉：作为 ReviewListModal 的子元素渲染在 .shell 内部，
 * 从右边缘滑入，不再独立居中弹窗。这样列表与详情同处一个画框，关抽屉
 * 即回到列表，符合「主列表 + 详情抽屉」的常见交互。
 *
 * 渲染要求：父组件需把本组件放在 `position: relative` 的容器内（ReviewListModal
 * 的 .shell 已是相对定位），本组件用 absolute 锚定到该容器的右侧。
 *
 * 数据来自后端 4 个透传路由（apps/daemon/src/routes/hik_routes/uedro.ts）：
 *   - POST /api/hik/uedro/reviewProcess      主数据（评审对象 + 稿件 + 评委名单）
 *   - POST /api/hik/uedro/reviewProgress     评委评审进度
 *   - POST /api/hik/uedro/commentList        缺陷/意见列表（按稿件+评委分组）
 *   - POST /api/hik/uedro/commentQuantity    缺陷统计（按稿件）
 *
 * open 变 true 时触发加载：
 *   1. 并行拉 reviewProcess + reviewProgress；
 *   2. reviewProcess 回来后取 data.list[0] 得到 manuscriptDtos[]，默认选首份稿件，
 *      再拉 commentList + commentQuantity（依赖 manuscriptId，串在主数据之后）。
 *   3. 切换稿件时只重拉 commentList + commentQuantity。
 *
 * 抽屉常驻 DOM：open 用 CSS class 控制 translateX 与遮罩显隐，保留退出动画。
 */
export function ReviewDetailDrawer({
  review,
  open,
  onClose,
}: {
  review: any;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 评审主数据（process.data.list[0]）：含 manuscriptDtos / repeat / 基本信息。
  const [detail, setDetail] = useState<any | null>(null);
  // 评委评审进度（reviewProgress.data[]）。
  const [reviewers, setReviewers] = useState<any[]>([]);
  // 缺陷/意见分组（commentList.data.mapList[] = [{ name, commentDtos[] }]）。
  const [commentGroups, setCommentGroups] = useState<any[]>([]);
  // 缺陷统计（commentQuantity.data = { all, toSolve, toVerify, closed, ... }）。
  const [quantity, setQuantity] = useState<any | null>(null);
  // 当前选中的稿件 id（默认首份稿件）。
  const [manuscriptId, setManuscriptId] = useState<string>('');

  // 弹窗关闭 / 组件卸载后不再写状态；过期请求丢弃。
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  const reviewId = pick(review?.reviewId, review?.id);
  const manuscripts: any[] = Array.isArray(detail?.manuscriptDtos) ? detail.manuscriptDtos : [];

  /** 拉主数据 + 评委进度（两者并行，都不依赖 manuscriptId）。 */
  async function loadCore(reqId: number, rid: string) {
    const [procRes, progRes] = await Promise.all([
      fetch('/api/hik/uedro/reviewProcess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: rid, pageNo: 1, pageSize: 50 }),
      }),
      fetch('/api/hik/uedro/reviewProgress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: rid }),
      }),
    ]);
    if (!procRes.ok) throw new Error(`reviewProcess HTTP ${procRes.status}`);
    if (!progRes.ok) throw new Error(`reviewProgress HTTP ${progRes.status}`);
    const procJson = await procRes.json();
    const progJson = await progRes.json();
    if (!procJson.ok) throw new Error(procJson?.msg || 'reviewProcess failed');
    if (!progJson.ok) throw new Error(progJson?.msg || 'reviewProgress failed');
    if (!aliveRef.current || reqId !== reqIdRef.current) return;

    const reviewDetail = procJson.data ?? null;
    setDetail(reviewDetail);
    setReviewers(Array.isArray(progJson.data) ? progJson.data : []);

    // 默认选中首份稿件；有稿件才拉缺陷列表/统计。
    const firstMid = reviewDetail?.manuscriptDtos?.[0]?.manuscriptId;
    if (firstMid) {
      setManuscriptId(firstMid);
      await loadComments(reqId, rid, firstMid);
    } else {
      setManuscriptId('');
      setCommentGroups([]);
      setQuantity(null);
    }
  }

  /** 拉缺陷列表 + 缺陷统计（依赖 manuscriptId，切换稿件时重拉）。 */
  async function loadComments(reqId: number, rid: string, mid: string) {
    const [listRes, qtyRes] = await Promise.all([
      fetch('/api/hik/uedro/commentList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: rid, manuscriptId: mid, pageNo: 1, pageSize: 100 }),
      }),
      fetch('/api/hik/uedro/commentQuantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: rid, manuscriptId: mid }),
      }),
    ]);
    if (!listRes.ok) throw new Error(`commentList HTTP ${listRes.status}`);
    if (!qtyRes.ok) throw new Error(`commentQuantity HTTP ${qtyRes.status}`);
    const listJson = await listRes.json();
    const qtyJson = await qtyRes.json();
    if (!aliveRef.current || reqId !== reqIdRef.current) return;
    // commentList/commentQuantity 上游失败不阻断详情展示，仅清空对应区。
    setCommentGroups(listJson.ok && Array.isArray(listJson.data?.mapList) ? listJson.data.mapList : []);
    setQuantity(qtyJson.ok ? qtyJson.data : null);
  }

  // 每次打开（或切换 reviewId）时重新拉取主数据 + 评委进度。
  useEffect(() => {
    if (!open) return;
    if (!reviewId || reviewId === '—') {
      setError('缺少 reviewId，无法加载评审详情');
      return;
    }
    aliveRef.current = true;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setDetail(null);
    setReviewers([]);
    setCommentGroups([]);
    setQuantity(null);
    setManuscriptId('');
    void loadCore(reqId, reviewId).catch((err: any) => {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setError('评审详情加载失败: ' + (err?.message || String(err)));
    }).finally(() => {
      if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
    });
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reviewId]);

  // 切换稿件：只重拉 commentList + commentQuantity。
  function switchManuscript(mid: string) {
    if (!mid || mid === manuscriptId) return;
    const reqId = reqIdRef.current;
    setManuscriptId(mid);
    setCommentGroups([]);
    setQuantity(null);
    void loadComments(reqId, reviewId, mid).catch((err: any) => {
      if (!aliveRef.current || reqId !== reqIdRef.current) return;
      setError('缺陷列表加载失败: ' + (err?.message || String(err)));
    });
  }

  // Esc 关闭：仅当抽屉打开时拦截。
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

  return (
    <>
      <div
        className={`${styles.overlay} ${open ? styles.overlayOpen : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="评审详情"
        aria-hidden={!open}
      >
        <DetailHead review={detail ?? review} onClose={onClose} />
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
          ) : (
            <>
              <ReviewerSection reviewers={reviewers} />
              <ManuscriptSection manuscripts={manuscripts} current={manuscriptId} onSwitch={switchManuscript} />
              <QuantitySection quantity={quantity} />
              <CommentSection groups={commentGroups} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** 头部：类型头像 + 评审名称 + 副标题 + 创建人/时间/剩余天数 + 关闭。
 *
 *  优先用主数据 detail（字段更全），未加载到位时回退到列表项 review。 */
function DetailHead({ review, onClose }: { review: any; onClose: () => void }) {
  const typeMeta = reviewTypeMeta(review);
  const reviewName = pick(review?.reviewName, review?.name);
  const creator = pick(review?.creator, review?.creatorName);
  const typeLabel = reviewTypeLabel(review);
  const createTime = pick(review?.createTime, review?.createdAt, review?.createDate);
  const endTime = pick(review?.preReviewEndTime, review?.endTime, review?.deadline);
  const remainDays = computeRemainDays(review?.preReviewEndTimeDate, review?.preReviewEndTime);
  const urgent = remainDays === null ? false : remainDays <= 0;
  const remainLabel = remainDays === null ? null : `剩余 ${Math.max(0, remainDays)} 天`;

  return (
    <div className={styles.head}>
      <div className={styles.headMain}>
        <div className={styles.headTop}>
          {typeMeta ? (
            <span className={styles.typeAvatar} style={{ background: typeMeta.color }} aria-hidden>
              {typeMeta.char}
            </span>
          ) : null}
          <h2 className={styles.title}>{reviewName}</h2>
          {remainLabel ? (
            <span className={`${styles.remainBadge} ${urgent ? styles.urgent : ''}`}>{remainLabel}</span>
          ) : null}
        </div>
        <div className={styles.headMeta}>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>类型：</span>
            <span className={styles.metaValue}>{typeLabel}</span>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>创建人：</span>
            <span className={styles.metaValue}>{creator}</span>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>创建时间：</span>
            <span className={styles.metaValue}>{createTime}</span>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>截止时间：</span>
            <span className={styles.metaValue}>{endTime}</span>
          </span>
        </div>
      </div>
      <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

/** 评委评审进度区：reviewProgress.data[] → 卡片列表（抽屉宽度有限，卡片比表格更舒展）。 */
function ReviewerSection({ reviewers }: { reviewers: any[] }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>评委进度</span>
        <span className={styles.sectionCount}>{reviewers.length} 位评委</span>
      </div>
      {reviewers.length === 0 ? (
        <div className={styles.emptyHint}>暂无评委数据</div>
      ) : (
        <div className={styles.reviewerList}>
          {reviewers.map((rv: any, i: number) => (
            <ReviewerCard key={rv?.userName ?? rv?.id ?? i} rv={rv} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单个评委进度卡片。status: 1=待评审, 2=评审中, 3=已提交（按上游常见取值映射）。 */
function ReviewerCard({ rv }: { rv: any }) {
  const name = pick(rv?.userName, rv?.name);
  const status = rv?.status;
  const { label, tone } =
    status === 1
      ? { label: '待评审', tone: '' }
      : status === 2
        ? { label: '评审中', tone: styles.doing }
        : status === 3
          ? { label: '已提交', tone: styles.done }
          : { label: pick(status), tone: '' };
  const committed = pick(rv?.committedTime);
  const defectNum = rv?.defectNum ?? 0;
  const adviceNum = rv?.adviceNum ?? 0;
  return (
    <div className={styles.reviewerCard}>
      <div className={styles.reviewerTop}>
        <span className={styles.reviewerName}>{name}</span>
        <span className={`${styles.statusBadge} ${tone}`}>{label}</span>
      </div>
      <div className={styles.reviewerMeta}>
        {committed !== '—' ? <span>提交：{committed}</span> : null}
        <span>
          缺陷 <b>{defectNum}</b>
        </span>
        <span>
          建议 <b>{adviceNum}</b>
        </span>
      </div>
    </div>
  );
}

/** 稿件切换区：manuscriptDtos[] 的 fileName 做下拉，切换时重拉缺陷列表/统计。 */
function ManuscriptSection({
  manuscripts,
  current,
  onSwitch,
}: {
  manuscripts: any[];
  current: string;
  onSwitch: (mid: string) => void;
}) {
  if (manuscripts.length === 0) return null;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>稿件</span>
        <span className={styles.sectionCount}>{manuscripts.length} 份</span>
      </div>
      <div className={styles.manuscriptPicker}>
        <span className={styles.pickerLabel}>当前稿件：</span>
        <select
          className={styles.manuscriptSelect}
          value={current}
          onChange={(e) => onSwitch(e.target.value)}
          aria-label="选择稿件"
        >
          {manuscripts.map((m: any, i: number) => {
            const mid = m?.manuscriptId ?? '';
            const label = pick(m?.fileName, m?.manuscriptId, `稿件 ${i + 1}`);
            return (
              <option key={mid || i} value={mid}>
                {label}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}

/** 缺陷统计区：commentQuantity.data → 4 个小卡片。 */
function QuantitySection({ quantity }: { quantity: any }) {
  if (!quantity) return null;
  const cards: { label: string; value: any; muted?: boolean }[] = [
    { label: '全部', value: quantity.all },
    { label: '待解决', value: quantity.toSolve },
    { label: '待验证', value: quantity.toVerify },
    { label: '已关闭', value: quantity.closed },
  ];
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>缺陷统计</span>
      </div>
      <div className={styles.statGrid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.statCard}>
            <span className={`${styles.statValue} ${c.muted ? styles.muted : ''}`}>{c.value ?? 0}</span>
            <span className={styles.statLabel}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 缺陷/意见列表区：commentList.data.mapList[] 按评委分组。 */
function CommentSection({ groups }: { groups: any[] }) {
  const total = groups.reduce((sum, g) => sum + (g?.commentDtos?.length ?? 0), 0);
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>缺陷 / 意见</span>
        <span className={styles.sectionCount}>共 {total} 条</span>
      </div>
      {total === 0 ? (
        <div className={styles.emptyHint}>暂无缺陷 / 意见</div>
      ) : (
        <div className={styles.commentGroups}>
          {groups.map((g: any, i: number) => (
            <CommentGroup key={g?.name ?? i} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单个评委分组：name + commentDtos[]。 */
function CommentGroup({ group }: { group: any }) {
  const name = pick(group?.name);
  const dtos: any[] = Array.isArray(group?.commentDtos) ? group.commentDtos : [];
  return (
    <div className={styles.commentGroup}>
      <div className={styles.commentGroupHead}>
        <span>{name}</span>
        <span className={styles.commentGroupCount}>{dtos.length} 条</span>
      </div>
      <div className={styles.commentList}>
        {dtos.map((c: any, i: number) => (
          <CommentItem key={c?.id ?? c?.commentId ?? i} comment={c} />
        ))}
      </div>
    </div>
  );
}

/** 单条缺陷/意见。字段对齐上游 commentDtos（content / createTime / defectType / status）。 */
function CommentItem({ comment }: { comment: any }) {
  const content = pick(comment?.content, comment?.text, comment?.description);
  const creator = pick(comment?.creator, comment?.userName, comment?.createUser);
  const time = pick(comment?.createTime, comment?.createdAt);
  const isDefect = comment?.defectType === '1' || comment?.defectType === 1 || comment?.type === 'defect';
  const solved = comment?.status === '3' || comment?.status === 3 || comment?.status === 'solved';
  return (
    <div className={styles.commentItem}>
      <div className={styles.commentContent}>{content}</div>
      <div className={styles.commentMeta}>
        {isDefect ? <span className={`${styles.commentTag} ${styles.defect}`}>缺陷</span> : null}
        {solved ? <span className={`${styles.commentTag} ${styles.solved}`}>已关闭</span> : null}
        {creator !== '—' ? <span>{creator}</span> : null}
        {time !== '—' ? <span>{time}</span> : null}
      </div>
    </div>
  );
}
