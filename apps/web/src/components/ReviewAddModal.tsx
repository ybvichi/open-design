import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ReviewAddModal.module.css';

/**
 * 发起评审 Modal：在羽点（uedro）上发起一条真实评审。
 *
 * 对齐羽点原站"发起评审"表单，支持两种评审类型：
 *   - 项目评审（reviewModel=1）：选项目 → 选评审名称模板 → 子类型 → 人员 → 上传稿件 → 提交
 *   - 部门评审（reviewModel=2）：直接输入评审名称 → 子类型 → 人员 → 上传稿件 → 提交
 *
 * 数据流（全部走 daemon 透传路由，见 apps/daemon/src/routes/hik_routes/uedro.ts）：
 *   - POST /api/hik/uedro/projectList   项目名称 autocomplete（项目模式）
 *   - POST /api/hik/uedro/reviewName    项目对应的评审名称模板（项目模式）
 *   - POST /api/hik/uedro/userList      人员 autocomplete（组长/作者/评委/抄送）
 *   - POST /api/hik/uedro/uploadManuscript  评审稿上传（multipart），拿 manuscriptId
 *   - POST /api/hik/uedro/reviewAddition    提交评审
 *
 * 提交体对齐原站 `review/v1/addition`：
 *   reviewName / description / reviewType / preReviewEndTime / reviewerMain[] /
 *   author[] / reviewers[] / coreReviewers[] / copyPersons[] / manuscriptId /
 *   reviewModel / projectId / projManager / projName（部门模式缺后三者）。
 *
 * 原站前置校验：核心评委不得与评审组长同名；评审稿 reviewType 必须与子类型一致。
 * 上游响应 {code:'0'} 视为成功。
 */

/** 评审子类型选项（对齐原站 select2：1 交互 / 2 视觉 / 3 文稿 / 4 表格 / 11 Pixso-Handoff）。 */
const REVIEW_SUBTYPES: { value: string; label: string }[] = [
  { value: '1', label: '交互评审' },
  { value: '2', label: '视觉评审' },
  { value: '3', label: '文稿评审' },
  { value: '4', label: '表格评审' },
  { value: '11', label: 'Pixso-Handoff' },
];

/** 评审子类型对应的稿件提示（对齐原站 uploadDrag 的 drag_text）。 */
const SUBTYPE_UPLOAD_HINT: Record<string, string> = {
  '1': '请上传交互评审文件的 zip、rar 包，小于 100MB',
  '2': '请上传视觉评审文件的 zip、rar 包，小于 100MB',
  '3': '请上传 pdf、word 格式的评审文件，小于 100MB',
  '4': '请上传 .xlsx 格式文件（目前不支持对象、窗格嵌入），小于 10MB',
  '11': '请上传 Pixso 平台导出 Handoff 评审文件，小于 100MB',
};

/** 人员对象（来自 /uedro/web/user/v1/list）：{id,name,email,userDeptPath,...}。 */
interface Person {
  id: string;
  name: string;
  email?: string;
  userDeptPath?: string;
  [k: string]: any;
}

/** 项目对象（来自 /uedro/web/project/v1/projectList）：{projNum,projName,projManager,...}。 */
interface Project {
  projNum: string;
  projName: string;
  projManager?: string;
  [k: string]: any;
}

/** 评审稿上传响应 data：{manuscriptId,url,compressUrl,staticTempFileDir,menInfo,reviewType}。 */
interface UploadInfo {
  manuscriptId: string;
  url: string;
  reviewType?: string;
  [k: string]: any;
}

export function ReviewAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // ── 表单状态 ──
  const [reviewModel, setReviewModel] = useState<1 | 2>(1); // 1 项目 / 2 部门
  // 项目模式：选中的项目 + 评审名称模板列表
  const [project, setProject] = useState<Project | null>(null);
  const [reviewTemplates, setReviewTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  // 部门模式：自由输入评审名称
  const [deptReviewName, setDeptReviewName] = useState('');
  const [subtype, setSubtype] = useState('1'); // select2，默认交互评审
  const [endtime, setEndtime] = useState(''); // datetime-local 值
  const [content, setContent] = useState(''); // 评审备注
  // 人员（对象数组，原站把整个人员对象塞进提交体）
  const [mainjudge, setMainjudge] = useState<Person[]>([]);
  const [author, setAuthor] = useState<Person[]>([]);
  const [coreReviewers, setCoreReviewers] = useState<Person[]>([]);
  const [judgelist, setJudgelist] = useState<Person[]>([]); // 团队评委（非必填）
  const [addPersonList, setAddPersonList] = useState<Person[]>([]); // 抄送（非必填）
  // 评审稿
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  // 提交
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const aliveRef = useRef(true);

  // 默认结束时间：今 + 2 天 23:59:59（对齐原站 getEndDate(2)）。
  // 用 datetime-local 的 `YYYY-MM-DDTHH:mm` 格式。
  useEffect(() => {
    if (!open) return;
    const d = new Date(Date.now() + 2 * 86400000);
    d.setHours(23, 59, 59, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEndtime(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  }, [open]);

  // 组件卸载 / 关闭后不再写状态。
  useEffect(() => {
    aliveRef.current = open;
    if (!open) {
      setError(null);
      setOkMsg(null);
    }
  }, [open]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  /** 评审名称：项目模式取模板的 reviewname_cn，部门模式取自由输入。 */
  const reviewNameForSubmit = useMemo(() => {
    if (reviewModel === 1) {
      // 原站提交的是 JSON.stringify(模板对象) —— 对齐原站 select3 的 value。
      return selectedTemplate ? JSON.stringify(selectedTemplate) : '';
    }
    return deptReviewName;
  }, [reviewModel, selectedTemplate, deptReviewName]);

  /** endtime 转原站格式 `YYYY/MM/DD HH:mm:ss`。 */
  const endtimeForSubmit = useMemo(() => {
    if (!endtime) return '';
    // datetime-local 是 "YYYY-MM-DDTHH:mm"，补秒并换分隔符。
    const d = new Date(endtime);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:59`;
  }, [endtime]);

  /** 拉项目对应的评审名称模板（项目模式选中项目后触发）。 */
  async function loadReviewTemplates(projNum: string) {
    if (!projNum) {
      setReviewTemplates([]);
      setSelectedTemplate(null);
      return;
    }
    try {
      const resp = await fetch('/api/hik/uedro/reviewName', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projNum }),
      });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setReviewTemplates([]);
        setSelectedTemplate(null);
        setError(j?.error?.message || '查询不到项目对应的评审名称类型，无法发起评审');
        return;
      }
      // 上游 data 是 JSON 串（"[{...}]" 或 "[null]"），解析成数组。
      const raw = typeof j.data === 'string' ? j.data : JSON.stringify(j.data ?? []);
      let arr: any[] = [];
      try {
        arr = JSON.parse(raw);
      } catch {
        arr = [];
      }
      const valid = arr.filter((x) => x && typeof x === 'object');
      setReviewTemplates(valid);
      setSelectedTemplate(valid[0] ?? null);
      if (!valid.length) setError('该项目没有可用的评审名称模板');
    } catch (err: any) {
      if (!aliveRef.current) return;
      setError('评审名称模板加载失败: ' + (err?.message || String(err)));
      setReviewTemplates([]);
    }
  }

  /** 上传评审稿：multipart/form-data，字段 file + excelJson（固定空串）。 */
  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('excelJson', '');
      const resp = await fetch('/api/hik/uedro/uploadManuscript', { method: 'POST', body: fd });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setError(j?.error?.message || j?.msg || `上传失败 HTTP ${resp.status}`);
        setUploadInfo(null);
        return;
      }
      setUploadInfo(j.data);
    } catch (err: any) {
      if (!aliveRef.current) return;
      setError('评审稿上传失败: ' + (err?.message || String(err)));
    } finally {
      if (aliveRef.current) setUploading(false);
    }
  }

  /** 提交评审。 */
  async function handleSubmit() {
    setError(null);
    setOkMsg(null);
    // 必填校验（对齐原站 rules）。
    if (reviewModel === 1 && !project?.projNum) {
      setError('请选择项目');
      return;
    }
    if (!reviewNameForSubmit) {
      setError(reviewModel === 1 ? '请选择评审名称' : '请输入评审名称');
      return;
    }
    if (!endtime) {
      setError('请选择结束时间');
      return;
    }
    if (!mainjudge.length) {
      setError('请添加评审组长');
      return;
    }
    if (!author.length) {
      setError('请添加作者');
      return;
    }
    if (!coreReviewers.length) {
      setError('请添加核心评委');
      return;
    }
    if (!uploadInfo?.manuscriptId) {
      setError('请上传评审稿');
      return;
    }
    // 核心评委不得与评审组长同名。
    const mainNames = new Set(mainjudge.map((p) => p.name));
    const dup = coreReviewers.find((p) => mainNames.has(p.name));
    if (dup) {
      setError('评审组长与评委重复');
      return;
    }
    // 评审稿类型必须与子类型一致（原站：parseInt(reviewType)===parseInt(select2)）。
    if (uploadInfo.reviewType && String(uploadInfo.reviewType) !== subtype) {
      setError('评审类型与上传评审稿格式不一致');
      return;
    }

    const body: Record<string, any> = {
      reviewName: reviewNameForSubmit,
      description: content,
      reviewType: subtype,
      preReviewEndTime: endtimeForSubmit,
      reviewerMain: mainjudge,
      author,
      reviewers: judgelist,
      coreReviewers,
      copyPersons: addPersonList,
      manuscriptId: uploadInfo.manuscriptId,
      reviewModel,
    };
    if (reviewModel === 1 && project) {
      body.projectId = project.projNum;
      body.projManager = project.projManager ?? '';
      body.projName = project.projName;
    }

    setSubmitting(true);
    try {
      const resp = await fetch('/api/hik/uedro/reviewAddition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await resp.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!resp.ok || !j?.ok) {
        setError(j?.error?.message || j?.msg || `发起评审失败 HTTP ${resp.status}`);
        return;
      }
      setOkMsg('创建成功');
      // 原站创建成功后刷新列表；这里 1.2s 后自动关闭，让调用方（FileView）的 toast 接力。
      setTimeout(() => {
        if (aliveRef.current) onClose();
      }, 1200);
    } catch (err: any) {
      if (!aliveRef.current) return;
      setError('发起评审失败: ' + (err?.message || String(err)));
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  }

  /** 切换评审类型时重置项目相关状态。 */
  function switchModel(m: 1 | 2) {
    setReviewModel(m);
    setProject(null);
    setReviewTemplates([]);
    setSelectedTemplate(null);
    setDeptReviewName('');
    setError(null);
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.shell} role="dialog" aria-modal="true">
        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.kicker}>REVIEW · UEDRO</div>
            <h2 className={styles.title}>发起评审</h2>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* ── 左栏：基本信息 ── */}
          <div className={styles.col}>
            <div className={styles.item}>
              <label className={styles.itemLabel}>
                评审类型 <span className={styles.req}>*</span>
              </label>
              <div className={styles.radioRow}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    checked={reviewModel === 1}
                    onChange={() => switchModel(1)}
                  />
                  项目评审
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    checked={reviewModel === 2}
                    onChange={() => switchModel(2)}
                  />
                  部门评审
                </label>
              </div>
            </div>

            {reviewModel === 1 ? (
              <>
                <div className={styles.item}>
                  <label className={styles.itemLabel}>
                    项目名称 <span className={styles.req}>*</span>
                  </label>
                  <ProjectPicker
                    value={project}
                    onChange={(p) => {
                      setProject(p);
                      setSelectedTemplate(null);
                      setReviewTemplates([]);
                      if (p?.projNum) void loadReviewTemplates(p.projNum);
                    }}
                  />
                </div>
                <div className={styles.item}>
                  <label className={styles.itemLabel}>
                    评审名称 <span className={styles.req}>*</span>
                  </label>
                  <select
                    className={styles.select}
                    value={selectedTemplate ? JSON.stringify(selectedTemplate) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedTemplate(v ? JSON.parse(v) : null);
                    }}
                    disabled={!reviewTemplates.length}
                  >
                    {!reviewTemplates.length ? (
                      <option value="">{project ? '无可用评审名称' : '请先选择项目'}</option>
                    ) : (
                      <>
                        <option value="">请选择评审名称</option>
                        {reviewTemplates.map((t, i) => (
                          <option key={i} value={JSON.stringify(t)}>
                            {t.reviewname_cn ?? t.reviewname ?? `模板 ${i + 1}`}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </>
            ) : (
              <div className={styles.item}>
                <label className={styles.itemLabel}>
                  评审名称 <span className={styles.req}>*</span>
                </label>
                <input
                  className={styles.input}
                  placeholder="请输入评审名称"
                  value={deptReviewName}
                  onChange={(e) => setDeptReviewName(e.target.value)}
                  maxLength={32}
                />
              </div>
            )}

            <div className={styles.item}>
              <label className={styles.itemLabel}>
                评审子类型 <span className={styles.req}>*</span>
              </label>
              <select
                className={styles.select}
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
              >
                {REVIEW_SUBTYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.item}>
              <label className={styles.itemLabel}>
                预计结束日期 <span className={styles.req}>*</span>
              </label>
              <input
                type="datetime-local"
                className={styles.input}
                value={endtime}
                onChange={(e) => setEndtime(e.target.value)}
              />
            </div>

            <div className={styles.item}>
              <label className={styles.itemLabel}>评审备注</label>
              <textarea
                className={styles.textarea}
                placeholder="请输入备注"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className={styles.item}>
              <label className={styles.itemLabel}>
                评审稿 <span className={styles.req}>*</span>
              </label>
              <div className={styles.uploadArea}>
                <UploadArea
                  subtype={subtype}
                  uploading={uploading}
                  uploadInfo={uploadInfo}
                  onPick={handleUpload}
                />
              </div>
            </div>
          </div>

          {/* ── 右栏：人员 ── */}
          <div className={styles.col}>
            <div className={styles.item}>
              <label className={styles.itemLabel}>
                评审组长 <span className={styles.req}>*</span>
              </label>
              <PersonPicker
                selected={mainjudge}
                onChange={setMainjudge}
                placeholder="请输入名称（评审组长）"
                multiple={false}
              />
            </div>
            <div className={styles.item}>
              <label className={styles.itemLabel}>
                作者 <span className={styles.req}>*</span>
              </label>
              <PersonPicker
                selected={author}
                onChange={setAuthor}
                placeholder="请输入名称（作者）"
              />
            </div>
            <div className={styles.item}>
              <label className={styles.itemLabel}>
                核心评委 <span className={styles.req}>*</span>
              </label>
              <PersonPicker
                selected={coreReviewers}
                onChange={setCoreReviewers}
                placeholder="请输入名称（核心评委）"
              />
            </div>
            <div className={styles.item}>
              <label className={styles.itemLabel}>团队评委</label>
              <PersonPicker
                selected={judgelist}
                onChange={setJudgelist}
                placeholder="请输入名称（团队评委）"
              />
            </div>
            <div className={styles.item}>
              <label className={styles.itemLabel}>抄送人员</label>
              <PersonPicker
                selected={addPersonList}
                onChange={setAddPersonList}
                placeholder="请输入名称（抄送人员）"
              />
            </div>
          </div>
        </div>

        <div className={styles.foot}>
          <span className={`${styles.footMsg} ${error ? styles.footMsgErr : ''} ${okMsg ? styles.footMsgOk : ''}`}>
            {error || okMsg || ''}
          </span>
          <div className={styles.footActions}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void handleSubmit()}
              disabled={submitting || uploading}
            >
              {submitting ? '提交中…' : '确定'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 人员选择器：输入框 + 防抖查询 /api/hik/uedro/userList，下拉选人，已选标签框。
 *
 * `multiple` 控制单选 / 多选：
 *   - 评审组长是单选（multiple=false）：选中即替换，标签框只显示一个，点 X 清空重选
 *   - 作者 / 评委 / 抄送是多选（multiple=true）：可累加多个，按 id 去重
 *
 * 选中项渲染在输入框下方的独立带框容器（selectedBox）里，每个标签含头像首字 +
 * 姓名 + 部门 + X。对齐原站 personAdd：trigger-on-focus=false（必须输入才查），
 * 选中后把人员整个对象加入数组（提交时原站把对象原样塞进 reviewerMain[] 等）。
 */
function PersonPicker({
  selected,
  onChange,
  placeholder,
  multiple = true,
}: {
  selected: Person[];
  onChange: (p: Person[]) => void;
  placeholder: string;
  multiple?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  // 300ms 防抖。
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // 查询。
  useEffect(() => {
    aliveRef.current = true;
    if (!debounced) {
      setResults([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetch('/api/hik/uedro/userList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: debounced, pageNo: 1, pageSize: 30 }),
    })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        const list: Person[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        setResults(list);
        setActiveIdx(0);
        setOpen(true);
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setResults([]);
      })
      .finally(() => {
        if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [debounced]);

  // 点外部收起下拉。
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  /** 添加一个人员：多选按 id 去重累加，单选直接替换。 */
  function add(p: Person) {
    if (multiple) {
      if (selected.some((x) => x.id === p.id)) {
        // 已存在则不动，仅收起下拉。
      } else {
        onChange([...selected, p]);
      }
    } else {
      onChange([p]);
    }
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function remove(idx: number) {
    if (multiple) {
      onChange(selected.filter((_, i) => i !== idx));
    } else {
      // 单选的 X 是清空，让用户重新选。
      onChange([]);
    }
  }

  const emptyHint = multiple ? '选中的评委将显示在这里' : '选中的组长将显示在这里';

  return (
    <div className={styles.acWrap} ref={wrapRef}>
      <input
        className={styles.acInput}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const p = results[activeIdx];
            if (p) add(p);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {loading ? <span className={styles.acSpinner} /> : null}
      {open && debounced ? (
        <div className={styles.acDropdown}>
          {!results.length ? (
            <div className={styles.acEmpty}>无匹配人员</div>
          ) : (
            results.map((p, i) => (
              <button
                key={p.id ?? i}
                type="button"
                className={`${styles.acItem} ${i === activeIdx ? styles.acItemActive : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => add(p)}
              >
                <span className={styles.acItemName}>{p.name}</span>
                {p.userDeptPath ? (
                  <span className={styles.acItemSub}>{p.userDeptPath}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
      {/* 已选人员独立框：空态显占位提示，有选中项时平铺标签。 */}
      <div className={styles.selectedBox}>
        {!selected.length ? (
          <span className={styles.selectedEmpty}>{emptyHint}</span>
        ) : (
          selected.map((p, i) => (
            <span key={p.id ?? i} className={styles.tag}>
              <span className={styles.tagAvatar} aria-hidden>
                {(p.name || '?').charAt(0).toUpperCase()}
              </span>
              <span className={styles.tagBody}>
                <span className={styles.tagName}>{p.name}</span>
                {p.userDeptPath ? (
                  <span className={styles.tagSub}>{p.userDeptPath.split('\\').pop()}</span>
                ) : null}
              </span>
              <button
                type="button"
                className={styles.tagRemove}
                onClick={() => remove(i)}
                aria-label={`移除 ${p.name}`}
              >
                ✕
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 项目选择器：输入框 + 防抖查 /api/hik/uedro/projectList，选中后回填项目对象。
 *
 * 对齐原站 el-autocomplete：trigger-on-focus=false，props.value=projShow
 * （"（projNum）projName" 展示串），选中后取回 projNum/projName/projManager。
 */
function ProjectPicker({
  value,
  onChange,
}: {
  value: Project | null;
  onChange: (p: Project | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    aliveRef.current = true;
    if (!debounced) {
      setResults([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetch('/api/hik/uedro/projectList', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projNumOrName: debounced, processType: 1, pageNo: 1, pageSize: 10 }),
    })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        const list: Project[] = Array.isArray(j?.data?.list) ? j.data.list : [];
        setResults(list);
        setActiveIdx(0);
        setOpen(true);
      })
      .catch(() => {
        if (!aliveRef.current) return;
        setResults([]);
      })
      .finally(() => {
        if (aliveRef.current && reqId === reqIdRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [debounced]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function projShow(p: Project): string {
    return `（${p.projNum}）${p.projName}`;
  }

  function pick(p: Project) {
    onChange(p);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  const display = value ? projShow(value) : query;

  return (
    <div className={styles.acWrap} ref={wrapRef}>
      <input
        className={styles.acInput}
        placeholder="请输入项目名称"
        value={display}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null);
        }}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const p = results[activeIdx];
            if (p) pick(p);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {loading ? <span className={styles.acSpinner} /> : null}
      {open && debounced ? (
        <div className={styles.acDropdown}>
          {!results.length ? (
            <div className={styles.acEmpty}>无匹配项目</div>
          ) : (
            results.map((p, i) => (
              <button
                key={p.projNum ?? i}
                type="button"
                className={`${styles.acItem} ${i === activeIdx ? styles.acItemActive : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(p)}
              >
                <span className={styles.acItemName}>{projShow(p)}</span>
                {p.projManager ? (
                  <span className={styles.acItemSub}>项目经理：{p.projManager}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 评审稿上传区：拖拽 / 点击选文件，上传中显 spinner，成功后显文件名 + 替换。 */
function UploadArea({
  subtype,
  uploading,
  uploadInfo,
  onPick,
}: {
  subtype: string;
  uploading: boolean;
  uploadInfo: UploadInfo | null;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hint = SUBTYPE_UPLOAD_HINT[subtype] ?? '请上传评审稿';

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    onPick(f);
  }

  if (uploadInfo?.manuscriptId && !uploading) {
    const name = uploadInfo.url || uploadInfo.manuscriptId;
    return (
      <div className={styles.uploadFileRow}>
        <span className={styles.uploadFileName}>{name}</span>
        <button
          type="button"
          className={styles.uploadReplace}
          onClick={() => inputRef.current?.click()}
        >
          替换
        </button>
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.uploadDrop}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        disabled={uploading}
      >
        {uploading ? (
          <>
            <span className={styles.acSpinner} />
            <span>上传中…</span>
          </>
        ) : (
          <>
            <span className={styles.uploadIcon}>⬆</span>
            <span>{hint}</span>
            <span>点击或拖拽文件到此处</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}
