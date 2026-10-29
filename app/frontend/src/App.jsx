import React, {useCallback, useEffect, useRef, useState} from 'react'
import {
    CancelOAuth, Capture, CheckHealthNow, CheckUpdate, DeleteAccount, FinishOAuth,
    FinishReOAuth, GetAppInfo, GetHealth, GetQuota, GetState, GetWeeklyCycles, RenameAccount,
    Rollback, StartOAuth, StartReOAuth, Use,
} from '../wailsjs/go/main/App'
import {BrowserOpenURL, EventsOn} from '../wailsjs/runtime/runtime'

function fmtNum(v) {
    return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}

function fmtDate(ms) {
    if (!ms) return ''
    // nextResetTime 可能是秒级时间戳，按数量级兜底
    if (ms < 1e12) ms *= 1000
    const d = new Date(ms)
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// fmtReset 重置时间显示文案：
// date 模式 = 具体日期；remaining 模式 = 剩余时长（不足1小时只到分钟，
// 5小时窗口自然落在「X小时Y分」、周窗口落在「X天Y小时Z分」，悬停可见精确时间点）
function fmtReset(ts, mode) {
    if (!ts) return ''
    if (ts < 1e12) ts *= 1000
    if (mode !== 'remaining') return `重置 ${fmtDate(ts)}`
    const diff = ts - Date.now()
    if (diff <= 0) return '已重置'
    const min = Math.floor(diff / 60000)
    const d = Math.floor(min / 1440)
    const h = Math.floor((min % 1440) / 60)
    const m = min % 60
    if (d > 0) return `${d}天${h}小时${m}分后重置`
    if (h > 0) return `${h}小时${m}分后重置`
    return `${m}分钟后重置`
}

// resetUrgency 倒计时紧迫度：<1h soon（琥珀）、<24h near（亮白）、其余默认灰
function resetUrgency(ts) {
    if (!ts) return ''
    if (ts < 1e12) ts *= 1000
    const diff = ts - Date.now()
    if (diff <= 0) return ''
    if (diff < 60 * 60 * 1000) return 'soon'
    if (diff < 24 * 60 * 60 * 1000) return 'near'
    return ''
}

// pctClass 用量百分比分级着色：<60 绿、<85 黄、否则红
function pctClass(p) {
    return p < 60 ? 'pct-low' : p < 85 ? 'pct-mid' : 'pct-high'
}

// PctBar 使用率迷你进度条（汇总行与限额行统一使用）
function PctBar({percent, width = 60}) {
    return (
        <span className="pct-bar" style={{width}}>
            <span className={`pct-bar-fill ${pctClass(percent)}`} style={{width: `${percent}%`}}/>
        </span>
    )
}

// ===== 行内 SVG 图标（24 viewBox、stroke currentColor、2px 描边，随按钮文字色变化；零依赖）=====
function Icon({d, size = 16, spin = false}) {
    return (
        <svg className={spin ? 'icon spin' : 'icon'} width={size} height={size} viewBox="0 0 24 24"
             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
             aria-hidden="true" focusable="false">
            {d}
        </svg>
    )
}

const ICONS = {
    // 切换账号（左右对调箭头）
    switch: (<>
        <path d="m16 3 4 4-4 4"/><path d="M20 7H4"/>
        <path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>
    </>),
    // 刷新（旋转箭头，查询中时旋转动画）
    refresh: (<>
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
    </>),
    // 改名（铅笔）
    pencil: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>,
    // 删除（垃圾桶）
    trash: (<>
        <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
        <line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>
    </>),
    // 设置（齿轮）
    settings: (<>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
    </>),
    // 添加账号（用户+加号）
    userPlus: (<>
        <path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/>
        <path d="M19 16v6"/><path d="M22 19h-6"/>
    </>),
    // 元信息说明（圆圈感叹号，悬停显示渠道/ID/时间）
    alert: (<>
        <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/>
        <line x1="12" x2="12.01" y1="16" y2="16"/>
    </>),
}

// ===== 术语提示文案（tooltip / 帮助弹窗共用，改文案只动这里）=====
const TIPS = {
    id: '账号去重 ID：优先取邮箱 hash，其次手机号 hash，都没有时用 uid 前 8 位',
    provider: raw => `登录渠道：抓取时从 ZCode 配置识别出的官方内置槽位（${raw}）`,
    captured: t => `抓取时间：该账号快照首次保存的时间 · ${t}`,
    fresh: t => `保鲜时间：最近一次把该账号最新登录态（刷新后的 token）写回快照的时间，越新鲜切换后越不易过期 · ${t}`,
    usagePct: '使用率 = 已用 ÷ 总额 ×100%；绿色 <60%，黄色 <85%，红色 ≥85%',
    validPeriod: '当前计费周期的结束时间（季付/年付的下一续费日）',
    fiveHourCard: '5小时重置卡：立即重置「每5小时」窗口的已用量',
    weekCard: '周重置卡：立即重置「每周」额度的已用量',
    weeklyCurrent: w => `本次周额度日均消耗 = 已用 ${w.percent}% ÷ 已过 ${w.daysElapsed.toFixed(1)} 天。周期开始时间由重置时间反推（重置 − 7 天），重置于 ${fmtDate(w.end)}`,
    weeklyProjection: w => `按当前节奏预计本周期总消耗 = 本次日均 × 7 天（${w.dailyPercent.toFixed(1)}%/天 × 7 ≈ ${w.projectedPercent.toFixed(0)}%）。超过 100% 表示照这个节奏额度会提前用完`,
    weeklyHistory: h => `平均每周消耗 = 近 ${h.cycles} 个完整周期「期末已用%」的均值（日均口径 = ${h.dailyPercent.toFixed(1)}%/天）。数据采样存于本地 ~/.zcas/quota-history.json，最多保留 13 个周期`,
    sessionExpired: '该账号的登录会话（oauth token）已在服务端过期，切换后 ZCode 会提示「套餐查询失败」。写代码不受影响（用的是长效凭证），需要点击「重新授权」刷新登录态',
}

// providerLabel 把内部渠道槽位 ID 映射成可读名称
function providerLabel(raw) {
    const map = {
        'builtin:zai-start-plan': 'z.ai Start Plan',
        'builtin:zai-coding-plan': 'z.ai Coding',
        'builtin:zai': 'z.ai',
        'builtin:bigmodel-coding-plan': 'BigModel Coding',
        'builtin:bigmodel-start-plan': 'BigModel Start Plan',
        '(encrypted)': '渠道未知',
    }
    return map[raw] || raw
}

// fmtRelative 相对时间：刚抓取/保鲜这类信息看新旧比看绝对日期更直观
function fmtRelative(ms) {
    if (!ms) return ''
    if (ms < 1e12) ms *= 1000
    const diff = Date.now() - ms
    if (diff < 0) return fmtShortDate(ms)
    const min = Math.floor(diff / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return `${min}分钟前`
    const hour = Math.floor(min / 60)
    if (hour < 24) return `${hour}小时前`
    const day = Math.floor(hour / 24)
    if (day === 1) return '昨天'
    if (day <= 30) return `${day}天前`
    return fmtShortDate(ms)
}

// fmtShortDate 月-日（当年省去年份）
function fmtShortDate(ms) {
    if (!ms) return ''
    if (ms < 1e12) ms *= 1000
    const d = new Date(ms)
    const now = new Date()
    const md = `${d.getMonth() + 1}月${d.getDate()}日`
    return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}

// fmtMD 月-日数字形式（10-28），周额度统计的周期范围用
function fmtMD(ms) {
    if (!ms) return ''
    if (ms < 1e12) ms *= 1000
    const d = new Date(ms)
    const p = n => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// QuotaView 展示一个账号的额度状态（自动加载 + 手动刷新）。
// showStartPlan：是否渲染 Start Plan 套餐额度块（总额/已用/剩余/各模型明细）。
// resetMode：重置时间显示模式（remaining=剩余时长 / date=具体日期）。
// showLimitNumbers：是否渲染限额行的已用/总量绝对数值（隐藏后保留百分比，悬停可查）。
// onOpenWeekly：点击周额度消耗汇总位时打开周期统计弹窗。
function QuotaView({qs, showStartPlan = true, resetMode = 'remaining', showLimitNumbers = true, onOpenWeekly}) {
    if (!qs) return null
    if (qs.loading && !qs.data) return <div className="quota-panel">查询中…</div>
    if (qs.error) return <div className="quota-panel quota-error">{qs.error}</div>
    const quota = qs.data
    if (!quota) return null
    // 无套餐账号（plans/balances 均空）三个汇总字段都是 null，逐个条件渲染，避免整行"未知"
    const hasNumbers = !!(quota.total != null || quota.used != null ||
        quota.remaining != null || quota.percentUsed != null)
    const hasSummary = showStartPlan && hasNumbers
    const hasItems = showStartPlan && !!(quota.items && quota.items.length > 0)
    const hasStartPlanData = !!(quota.planTier || hasNumbers || (quota.items && quota.items.length > 0))
    // 套餐徽标：汇总行没渲染（无数值或用户隐藏）时并入 Coding Plan 标签行，避免孤儿行
    const tierBadge = showStartPlan && quota.planTier ? quota.planTier.label : null
    const rc = quota.resetCards
    const hasCards = !!(rc && (rc.fiveHour.count > 0 || rc.week.count > 0))
    const earliestExpiry = rc
        ? [rc.fiveHour.count > 0 ? rc.fiveHour.earliestExpiry : 0, rc.week.count > 0 ? rc.week.earliestExpiry : 0]
            .filter(v => v > 0).sort((a, b) => a - b)[0]
        : 0
    const lastUsedAt = rc
        ? [rc.fiveHour.lastUsedAt, rc.week.lastUsedAt].filter(v => v > 0).sort((a, b) => b - a)[0]
        : 0
    // 重置卡是 Coding Plan 的权益，渲染在 codingPlan 区块内部；
    // codingPlan 查询失败（静默）但有卡时兜底独立显示。
    const resetCardsRow = hasCards && (
        <div className="quota-row quota-reset-cards">
            <span className="tier">重置卡</span>
            {rc.fiveHour.count > 0 &&
                <span title={TIPS.fiveHourCard}>⚡ 5小时 ×{rc.fiveHour.count}</span>}
            {rc.week.count > 0 &&
                <span title={TIPS.weekCard}>📅 周 ×{rc.week.count}</span>}
            {earliestExpiry > 0 && <span className="reset-time">最早 {fmtDate(earliestExpiry)} 过期</span>}
            {lastUsedAt > 0 && <span className="reset-time">上次使用 {fmtDate(lastUsedAt)}</span>}
        </div>
    )
    if (!hasSummary && !hasItems && !quota.codingPlan && !hasCards) {
        // 唯一内容是被过滤隐藏的 Start Plan 块时不渲染，避免误显示「暂无有效套餐」
        if (hasStartPlanData) return null
        return <div className="quota-panel quota-empty">暂无有效套餐</div>
    }
    return (
        <div className="quota-panel">
            {hasSummary && (
                <div className="quota-row">
                    {quota.planTier && <span className="tier">{quota.planTier.label}</span>}
                    {quota.total != null && <span>总额 {fmtNum(quota.total)}</span>}
                    {quota.used != null && <span>已用 {fmtNum(quota.used)}</span>}
                    {quota.remaining != null &&
                        <span>剩余 <b className="num-remaining">{fmtNum(quota.remaining)}</b></span>}
                    {quota.percentUsed !== null && quota.percentUsed !== undefined &&
                        <span title={TIPS.usagePct}>使用率 <b className={pctClass(quota.percentUsed)}>{quota.percentUsed.toFixed(1)}%</b>
                            <PctBar percent={quota.percentUsed}/>
                        </span>}
                </div>
            )}
            {hasItems && quota.items.map((it, i) => (
                <div className="quota-item" key={i}>
                    <span className="quota-item-name">{it.name}</span>
                    {it.remaining != null && it.total != null &&
                        <span className="quota-item-value">剩 <b className="num-remaining">{fmtNum(it.remaining)}</b>
                            <span className="num-dim"> / {fmtNum(it.total)}</span></span>}
                </div>
            ))}
            {quota.codingPlan ? (
                <>
                    {/* 上方无内容时不出分割线；套餐徽标在汇总行没渲染时并入本行（如只有订阅信息无数值的账号） */}
                    <div className={`quota-row${hasSummary || hasItems ? ' quota-coding-plan' : ''}`}>
                        {tierBadge && !hasSummary && <span className="tier">{tierBadge}</span>}
                        <span className="tier">
                            {quota.codingPlan.productName ||
                                `Coding Plan${quota.codingPlan.level ? ' ' + quota.codingPlan.level : ''}`}
                        </span>
                        {quota.codingPlan.validPeriod &&
                            <span className="valid-period" title={TIPS.validPeriod}>有效期至 {quota.codingPlan.validPeriod}</span>}
                    </div>
                    {/* 限额两行为一组（网格列跨行对齐）；周额度日均作为右侧汇总位：
                        竖排、垂直居中于整组、虚线分隔——它是额度区的结论性信息 */}
                    <div className="quota-limits-wrap">
                        <div className={`quota-limits${showLimitNumbers ? '' : ' quota-limits-no-num'}`}>
                            {quota.codingPlan.limits.map((l, i) => (
                                <React.Fragment key={`cp-${i}`}>
                                    <span className="quota-item-name">{l.name}</span>
                                    {showLimitNumbers &&
                                        <span className="quota-limit-usage"><b>{fmtNum(l.used)}</b>
                                            <span className="num-dim"> / {fmtNum(l.limit)}</span></span>}
                                    <span className="quota-limit-pct"
                                          title={showLimitNumbers ? TIPS.usagePct
                                              : `已用 ${fmtNum(l.used)} / ${fmtNum(l.limit)} · ${TIPS.usagePct}`}>
                                        <b className={pctClass(l.percent)}>{l.percent}%</b>
                                        <PctBar percent={l.percent} width={44}/>
                                    </span>
                                    <span className={`reset-time reset-${resetUrgency(l.nextReset) || 'idle'}`}
                                          title={l.nextReset > 0 ? `重置 ${fmtDate(l.nextReset)}` : ''}>
                                        {l.nextReset > 0 ? fmtReset(l.nextReset, resetMode) : ''}
                                    </span>
                                </React.Fragment>
                            ))}
                            {/* 本月累计：上限为按周额度折算（周限额 × 当月天数 ÷ 7），与限额行同构；
                                数值隐藏时不渲染占位格（本月行恒有末列，3/4 列模板都恰好占满） */}
                            {quota.weekly?.monthly && (
                                <>
                                    <span className="quota-item-name">本月</span>
                                    {showLimitNumbers &&
                                        <span className="quota-limit-usage">
                                            <b>{fmtNum(Math.round(quota.weekly.monthly.credits))}</b>
                                            {quota.weekly.monthly.limitCredits > 0 &&
                                                <span className="num-dim"> / {fmtNum(Math.round(quota.weekly.monthly.limitCredits))}</span>}
                                        </span>}
                                    <span className="quota-limit-pct"
                                          title={`本月已用 = 累计积分 ÷ 折算月上限；折算月上限 = 周限额 × 当月天数 ÷ 7（套餐无独立月度上限）· 日均 ${fmtNum(Math.round(quota.weekly.monthly.dailyAvg))} 积分/天 · 覆盖 ${quota.weekly.monthly.days} 天`}>
                                        {quota.weekly.monthly.limitCredits > 0 && <>
                                            <b className={pctClass(quota.weekly.monthly.percent)}>
                                                {quota.weekly.monthly.percent.toFixed(0)}%
                                            </b>
                                            <PctBar percent={quota.weekly.monthly.percent} width={44}/>
                                        </>}
                                    </span>
                                    <span className="reset-time"
                                          title={`额度按 7 天周期滚动，不随自然月重置；此为按当前节奏预计全月消耗（日均 × 当月天数 ÷ 折算上限）`}>
                                        {quota.weekly.monthly.limitCredits > 0 && quota.weekly.monthly.projectedPercent > 0
                                            ? `预计全月 ${quota.weekly.monthly.projectedPercent.toFixed(0)}%`
                                            : `自然月 ${quota.weekly.monthly.month}`}
                                    </span>
                                </>
                            )}
                        </div>
                        {quota.weekly && (quota.weekly.current || quota.weekly.historical) && (
                            <div className="quota-daily" role="button" tabIndex={0}
                                 title="周额度消耗节奏（点击查看各周期统计）"
                                 onClick={onOpenWeekly}
                                 onKeyDown={e => {
                                     if (e.key === 'Enter' || e.key === ' ') onOpenWeekly?.()
                                 }}>
                                {quota.weekly.current &&
                                    <span title={TIPS.weeklyCurrent(quota.weekly.current)}>
                                        <span className="dv-label">本次</span>
                                        <b className="dv-cur">{quota.weekly.current.dailyPercent.toFixed(1)}</b><span
                                        className="num-dim">%/天</span>
                                    </span>}
                                {quota.weekly.current &&
                                    <span title={TIPS.weeklyProjection(quota.weekly.current)}>
                                        <span className="dv-label">预计本周</span>
                                        <b className={pctClass(quota.weekly.current.projectedPercent)}>
                                            {quota.weekly.current.projectedPercent.toFixed(0)}</b><span
                                        className="num-dim">%</span>
                                    </span>}
                                {quota.weekly.historical &&
                                    <span title={TIPS.weeklyHistory(quota.weekly.historical)}>
                                        <span className="dv-label">均每周</span>
                                        <b className="dv-avg">{quota.weekly.historical.weeklyPercent.toFixed(0)}</b><span
                                        className="num-dim">%</span>
                                    </span>}
                            </div>
                        )}
                    </div>
                    {resetCardsRow}
                </>
            ) : resetCardsRow}
        </div>
    )
}

function ConfirmDialog({text, onOk, onCancel}) {
    return (
        <div className="modal-mask" onClick={onCancel}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <p className="confirm-text">{text}</p>
                <div className="confirm-actions">
                    <button className="btn" onClick={onCancel}>取消</button>
                    <button className="btn btn-danger-solid" onClick={onOk}>确定</button>
                </div>
            </div>
        </div>
    )
}



// VersionModal 关于弹窗（数据来自后端内嵌的全局配置）
function VersionModal({info, onClose}) {
    return (
        <div className="modal-mask" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3 className="help-title">关于 {info.displayName}</h3>
                <div className="version-row"><span>当前版本</span><b>v{info.version}</b></div>
                <div className="version-row"><span>项目地址</span><b>{info.repository.replace('https://', '')}</b></div>
                <div className="confirm-actions">
                    <button className="btn" onClick={() => BrowserOpenURL(info.repository)}>项目主页</button>
                    <button className="btn btn-primary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    )
}

// UpdateModal 检查更新（打开即查询）
function UpdateModal({onClose}) {
    const [st, setSt] = useState({loading: true})
    useEffect(() => {
        CheckUpdate()
            .then(r => setSt({loading: false, result: r}))
            .catch(e => setSt({loading: false, error: String(e)}))
    }, [])
    const r = st.result
    return (
        <div className="modal-mask" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3 className="help-title">检查更新</h3>
                {st.loading && <p className="hint">正在查询最新版本…</p>}
                {st.error && <p className="hint warn">检查失败：{st.error}</p>}
                {r && (
                    <>
                        <div className="version-row"><span>当前版本</span><b>v{r.current}</b></div>
                        <div className="version-row"><span>最新版本</span><b>v{r.latest}</b></div>
                        {r.hasUpdate
                            ? <p className="hint warn">发现新版本 v{r.latest}</p>
                            : <p className="hint">已是最新版本 ✓</p>}
                    </>
                )}
                <div className="confirm-actions">
                    {r?.hasUpdate &&
                        <button className="btn btn-primary" onClick={() => BrowserOpenURL(r.url)}>去下载</button>}
                    <button className="btn" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    )
}

// HelpModal 术语说明（tooltip 没注意到的用户从这里查）
function HelpModal({onClose}) {
    const terms = [
        ['渠道', '账号登录的官方渠道，如 BigModel Coding / z.ai Start Plan，抓取时自动识别'],
        ['ID', TIPS.id],
        ['🕐 抓取时间', '该账号快照首次保存的时间'],
        ['🔄 保鲜', '最近一次把该账号的最新登录态（刷新后的 token）写回快照的时间。越新鲜，切换过去越不容易遇到登录过期'],
        ['使用率', TIPS.usagePct],
        ['有效期至', TIPS.validPeriod],
        ['⚡ 5小时重置卡', TIPS.fiveHourCard],
        ['📅 周重置卡', TIPS.weekCard],
        ['日均消耗·本次', '本周期的周额度平均每天消耗：已用% ÷ 已过天数。周期开始时间由重置时间反推（重置时间 − 7 天），所以刚重置完的头几个小时数值会偏大'],
        ['预计本周', '按当前节奏预计本周期总消耗 = 本次日均 × 7 天。超过 100% 表示照这个节奏周额度会提前用完，需要降低消耗或用周重置卡'],
        ['均每周', '过去各完整周期「期末已用%」的平均值，即平时每周的周额度消耗水平；整周未使用的周期不计入。数据采样存在本地，删账号时一并清除'],
        ['会话过期', '该账号的 BigModel/z.ai 登录会话已在服务端过期，ZCode 里会提示「套餐查询失败」。写代码不受影响（用长效凭证）；点击账号上的「重新授权」重新走一次浏览器授权即可恢复，之后后台会定期保活以减少再次过期的概率'],
    ]
    return (
        <div className="modal-mask" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3 className="help-title">字段说明</h3>
                <dl className="help-glossary">
                    {terms.map(([t, d]) => (
                        <div className="help-term" key={t}>
                            <dt>{t}</dt>
                            <dd>{d}</dd>
                        </div>
                    ))}
                </dl>
                <div className="confirm-actions">
                    <button className="btn" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    )
}

// SettingsModal 显示设置：Start Plan 额度块显隐、重置时间显示模式、限额数值显隐
// （选择即时生效并持久化）
function SettingsModal({showStartPlan, onToggleStartPlan, resetMode, onResetMode,
                           showLimitNumbers, onToggleLimitNumbers, onClose}) {
    return (
        <div className="modal-mask" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3 className="help-title">显示设置</h3>
                <div className="settings-item">
                    <div className="settings-label">Start Plan 套餐额度</div>
                    <div className="provider-choices">
                        <button className={showStartPlan ? 'choice active' : 'choice'}
                                onClick={() => onToggleStartPlan(true)}>显示</button>
                        <button className={!showStartPlan ? 'choice active' : 'choice'}
                                onClick={() => onToggleStartPlan(false)}>隐藏</button>
                    </div>
                    <p className="hint">各账号行内的总额 / 已用 / 剩余与各模型明细；隐藏后仅保留 Coding Plan 限额、日均消耗与重置卡</p>
                </div>
                <div className="settings-item">
                    <div className="settings-label">重置时间显示</div>
                    <div className="provider-choices">
                        <button className={resetMode === 'remaining' ? 'choice active' : 'choice'}
                                onClick={() => onResetMode('remaining')}>剩余时长</button>
                        <button className={resetMode === 'date' ? 'choice active' : 'choice'}
                                onClick={() => onResetMode('date')}>具体日期</button>
                    </div>
                    <p className="hint">剩余时长如「3小时25分后重置」「4天23小时15分后重置」，每半分钟自动走字；悬停始终显示具体时间点</p>
                </div>
                <div className="settings-item">
                    <div className="settings-label">限额用量数值</div>
                    <div className="provider-choices">
                        <button className={showLimitNumbers ? 'choice active' : 'choice'}
                                onClick={() => onToggleLimitNumbers(true)}>显示</button>
                        <button className={!showLimitNumbers ? 'choice active' : 'choice'}
                                onClick={() => onToggleLimitNumbers(false)}>隐藏</button>
                    </div>
                    <p className="hint">「每5小时 / 每周」限额行的已用与总量绝对数值；隐藏后百分比与进度条左移补位，悬停百分比可查看具体数值</p>
                </div>
                <div className="confirm-actions">
                    <button className="btn btn-primary" onClick={onClose}>完成</button>
                </div>
            </div>
        </div>
    )
}

// WeeklyModal 周额度统计：各周期用量明细。官方按天积分口径（credit-usage/activity，
// 每次查额度自动同步），周期用量 = 周期内各天积分之和；无官方数据时回退本地采样。
function WeeklyModal({id, label, onClose}) {
    const [st, setSt] = useState({loading: true})
    useEffect(() => {
        GetWeeklyCycles(id)
            .then(r => setSt({loading: false, report: r}))
            .catch(e => setSt({loading: false, error: String(e)}))
    }, [id])
    const list = st.report?.cycles || []
    const done = list.filter(c => !c.active)
    const avg = done.length ? done.reduce((s, c) => s + c.finalPct, 0) / done.length : null
    return (
        <div className="modal-mask" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3 className="help-title">周额度统计 · {label}</h3>
                {st.loading && <p className="hint">加载中…</p>}
                {st.error && <p className="hint warn">{st.error}</p>}
                {list.length > 0 ? (
                    <>
                        <p className="hint">
                            {st.report?.streakDays > 0 &&
                                <>连续使用 <b>{st.report.streakDays}</b> 天（最长 {st.report.longestStreakDays} 天）· </>}
                            {avg != null
                                ? <>完整周期 {done.length} 个 · 均每周 <b>{avg.toFixed(0)}%</b></>
                                : <>当前周期尚未结束——结束后这里出现第一条统计</>}
                        </p>
                        <div className="weekly-list">
                            {list.map((c, i) => (
                                <div className={`weekly-row${c.active ? ' weekly-active' : ''}`} key={i}>
                                    <span className="weekly-range">
                                        {c.active ? '进行中' : `${fmtMD(c.start)} ~ ${fmtMD(c.end)}`}
                                    </span>
                                    <span className="weekly-credits"
                                          title="周期内各天积分之和（官方按天数据；周期起止落在日内时，边界日按时间占比加权）">
                                        {c.usedCredits > 0
                                            ? <><b>{fmtNum(Math.round(c.usedCredits))}</b>
                                                <span className="num-dim">{c.limitCredits > 0 ? ` / ${fmtNum(Math.round(c.limitCredits))}` : ''}</span></>
                                            : <span className="num-dim">无官方数据</span>}
                                    </span>
                                    <span className="weekly-pct">
                                        <b className={pctClass(c.finalPct)}>{c.finalPct.toFixed(0)}%</b>
                                        <PctBar percent={c.finalPct} width={90}/>
                                    </span>
                                </div>
                            ))}
                        </div>
                        <p className="hint">数据源：官方按天积分接口（查询额度时自动同步，每小时限频一次）</p>
                    </>
                ) : !st.loading && !st.error && (
                    <p className="hint">还没有周额度记录。刷新一次额度即可：工具会同步官方按天积分并开始采样，
                        当前周期结束后出现第一条统计。</p>
                )}
                <div className="confirm-actions">
                    <button className="btn btn-primary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    )
}

// indexHealth 把后端的健康状态列表转成按账号 id 索引的对象
function indexHealth(list) {
    const out = {}
    ;(list || []).forEach(r => {
        out[r.id] = r
    })
    return out
}

// reauthDoneMsg 重新授权完成的提示文案（是否刷新了当前登录态、是否重启了 ZCode）
function reauthDoneMsg(label, liveRefreshed, restarted) {
    if (liveRefreshed) {
        return `已重新授权 ${label}，当前登录态已刷新${restarted ? '，ZCode 已重启' : ''}`
    }
    return `已重新授权 ${label}，登录态已更新（下次切换生效）`
}

// AccountRow 一行一个账号：左侧信息（额度内容多少不定），操作按钮固定右上角。
// health: 会话健康报告（undefined=未检测）；reauthActive: 该行正处于重新授权等待回调状态
function AccountRow({meta, isCurrent, quotaState, onRefreshQuota, onAction, notify, askConfirm,
                         health, reauthActive, onStartReauth, onFinishReauth, onCancelReauth,
                         showStartPlan, resetMode, showLimitNumbers, onOpenWeekly}) {
    const [busy, setBusy] = useState('')
    const [renaming, setRenaming] = useState(false)
    const [newName, setNewName] = useState(meta.label)
    const [callback, setCallback] = useState('')
    const expired = health?.status === 'expired'
    // 元信息（渠道/ID/时间/备注）合并到名字后的「!」图标 tooltip，行内不再常驻展示
    const metaTip = [
        `渠道：${providerLabel(meta.provider)}`,
        `ID：${meta.id}`,
        `抓取：${fmtDate(meta.capturedAt)}`,
        meta.updatedAt > 0 ? `保鲜：${fmtRelative(meta.updatedAt)}（${fmtDate(meta.updatedAt)}）` : '',
        meta.note ? `备注：${meta.note}` : '',
    ].filter(Boolean).join('\n')

    const run = async (name, fn) => {
        setBusy(name)
        try {
            await fn()
        } catch (e) {
            notify(String(e), 'error')
        } finally {
            setBusy('')
        }
    }

    return (
        <div className={`row ${isCurrent ? 'row-current' : ''}`}>
            <div className="row-main">
                <div className="row-title">
                    {renaming ? (
                        <input className="rename-input" value={newName}
                               onChange={e => setNewName(e.target.value)}
                               autoFocus onKeyDown={e => {
                            if (e.key === 'Enter') run('rename', async () => {
                                await RenameAccount(meta.id, newName)
                                setRenaming(false)
                                notify('已重命名')
                                onAction()
                            })
                            if (e.key === 'Escape') setRenaming(false)
                        }}/>
                    ) : (
                        <>
                            <span className="row-label" onDoubleClick={() => setRenaming(true)}
                                  title="双击或点铅笔改名">{meta.label}</span>
                            <button className="icon-btn-inline" title="改名" aria-label={`改名 ${meta.label}`}
                                    disabled={!!busy} onClick={() => setRenaming(true)}>
                                <Icon d={ICONS.pencil} size={13}/>
                            </button>
                        </>
                    )}
                    {isCurrent && <span className="badge-live">当前登录</span>}
                    {expired && <span className="badge-expired" title={TIPS.sessionExpired}>会话过期</span>}
                    <span className="meta-info" tabIndex={0} title={metaTip}>
                        <Icon d={ICONS.alert} size={13}/>
                    </span>
                </div>
                <QuotaView qs={quotaState} showStartPlan={showStartPlan} resetMode={resetMode}
                           showLimitNumbers={showLimitNumbers}
                           onOpenWeekly={() => onOpenWeekly(meta.id, meta.label)}/>
                {reauthActive && (
                    <div className="reauth-panel">
                        <p className="hint">已打开浏览器等待授权，完成后会自动跳回并更新登录态。
                            请确认浏览器里登录的是「{meta.label}」，不是的话先在网页上切换登录。
                            若跳转到了 ZCode 客户端，请复制地址栏链接粘贴到下方：</p>
                        <textarea rows={2} value={callback} onChange={e => setCallback(e.target.value)}
                                  placeholder="zcode://oauth/callback?authCode=...&state=..."/>
                        <div className="reauth-actions">
                            <button className="btn btn-primary" disabled={!!busy || !callback.trim()}
                                    onClick={() => run('reauth', async () => {
                                        await onFinishReauth(callback)
                                        setCallback('')
                                    })}>
                                {busy === 'reauth' ? '正在授权…' : '完成授权'}
                            </button>
                            <button className="btn" disabled={!!busy} onClick={() => {
                                setCallback('')
                                onCancelReauth()
                            }}>取消</button>
                        </div>
                    </div>
                )}
            </div>
            <div className="row-actions">
                <button className="btn btn-icon btn-primary" disabled={!!busy || isCurrent}
                        title={busy === 'use' ? '切换中…' : `切换到 ${meta.label}`}
                        aria-label={`切换到 ${meta.label}`}
                        onClick={() => {
                            const doUse = () => run('use', async () => {
                                const r = await Use(meta.id)
                                notify(`已切换到 ${r.label}${r.restarted ? '，ZCode 已重启' : ''}`)
                                onAction()
                            })
                            if (expired) {
                                askConfirm(`账号「${meta.label}」的登录会话已过期，切换后 ZCode 的套餐/用量查询会失败（写代码不受影响）。仍要切换吗？`, doUse)
                            } else {
                                doUse()
                            }
                        }}>
                    <Icon d={ICONS.switch} spin={busy === 'use'}/>
                </button>
                <button className="btn btn-icon" disabled={!!busy || quotaState?.loading}
                        title={quotaState?.loading ? '查询中…' : '刷新额度'} aria-label="刷新额度"
                        onClick={() => onRefreshQuota(meta.id)}>
                    <Icon d={ICONS.refresh} spin={!!quotaState?.loading}/>
                </button>
                {expired && !reauthActive &&
                    <button className="btn btn-warn" disabled={!!busy}
                            title="该账号登录会话已过期，重新走一次浏览器授权即可恢复"
                            onClick={() => run('reauth-start', async () => {
                                await onStartReauth(meta.id)
                            })}>重新授权</button>}
                <button className="btn btn-icon btn-danger" disabled={!!busy}
                        title={`删除账号 ${meta.label}`} aria-label={`删除账号 ${meta.label}`}
                        onClick={() => askConfirm(`确定删除账号「${meta.label}」的快照？`,
                            () => run('del', async () => {
                                await DeleteAccount(meta.id)
                                notify('已删除')
                                onAction()
                            }))}>
                    <Icon d={ICONS.trash}/>
                </button>
            </div>
        </div>
    )
}

// CurrentGuestRow 当前登录但未保存的账号（置顶显示，可一键保存入库）
function CurrentGuestRow({current, quotaState, onRefreshQuota, onSave, showStartPlan, resetMode, showLimitNumbers, onOpenWeekly}) {
    const metaTip = `渠道：${providerLabel(current.provider)}\nID：${current.shortId}`
    return (
        <div className="row row-current row-guest">
            <div className="row-main">
                <div className="row-title">
                    <span className="row-label">{current.label}</span>
                    <span className="badge-live">当前登录</span>
                    <span className="badge-unsaved">未保存</span>
                    <span className="meta-info" tabIndex={0} title={metaTip}>
                        <Icon d={ICONS.alert} size={13}/>
                    </span>
                </div>
                <QuotaView qs={quotaState} showStartPlan={showStartPlan} resetMode={resetMode}
                           showLimitNumbers={showLimitNumbers}
                           onOpenWeekly={() => onOpenWeekly('', current.label)}/>
            </div>
            <div className="row-actions">
                <button className="btn btn-primary" onClick={onSave}>保存入库</button>
                <button className="btn btn-icon" disabled={quotaState?.loading}
                        title={quotaState?.loading ? '查询中…' : '刷新额度'} aria-label="刷新额度"
                        onClick={() => onRefreshQuota('current')}>
                    <Icon d={ICONS.refresh} spin={!!quotaState?.loading}/>
                </button>
            </div>
        </div>
    )
}

function AddAccountModal({onClose, onDone, notify}) {
    const [tab, setTab] = useState('capture')
    const [provider, setProvider] = useState('zai')
    const [name, setName] = useState('')
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)
    const [oauthOpened, setOauthOpened] = useState(false)
    const [callback, setCallback] = useState('')
    const [existLabel, setExistLabel] = useState('')

    // 监听浏览器回调自动完成事件（协议接管成功时，无需任何手动操作）
    useEffect(() => {
        const offDone = EventsOn('oauth:done', (r) => {
            if (r?.reauth) return // 重新授权流程的事件由主界面处理
            notify(r.created
                ? `已添加账号 ${r.label}${r.billingReady ? '' : '（额度初始化中，稍后查询）'}`
                : `该账号已存在（${r.label}）`)
            onDone()
        })
        const offErr = EventsOn('oauth:error', (msg) => notify(String(msg), 'error'))
        return () => {
            offDone()
            offErr()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const doCapture = async (overwrite) => {
        setBusy(true)
        try {
            const r = await Capture(name, note, overwrite)
            if (!r.created && !overwrite) {
                setExistLabel(r.meta.label)
                return
            }
            notify(overwrite ? `已用当前登录态覆盖更新 ${r.meta.label}` : `已保存账号 ${r.meta.label}`)
            onDone()
        } catch (e) {
            notify(String(e), 'error')
        } finally {
            setBusy(false)
        }
    }

    const doFinishOAuth = async () => {
        setBusy(true)
        try {
            const r = await FinishOAuth(callback, name, note)
            if (!r.created) {
                notify(`该账号已存在（${r.meta.label}）`)
            } else {
                notify(`已添加账号 ${r.meta.label}${r.billingReady ? '' : '（额度初始化中，稍后查询）'}`)
            }
            onDone()
        } catch (e) {
            notify(String(e), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="modal-mask" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-tabs">
                    <button className={tab === 'capture' ? 'tab active' : 'tab'}
                            onClick={() => setTab('capture')}>抓取当前登录</button>
                    <button className={tab === 'oauth' ? 'tab active' : 'tab'}
                            onClick={() => setTab('oauth')}>OAuth 登录新账号</button>
                </div>
                <div className="field">
                    <label>名称（留空用邮箱/手机号）</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：主账号"/>
                </div>
                <div className="field">
                    <label>备注</label>
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="可选"/>
                </div>
                {tab === 'capture' ? (
                    <>
                        <p className="hint">把 ZCode 客户端当前登录的账号保存为快照（只保存账号字段，不影响其他设置）。</p>
                        {existLabel ? (
                            <>
                                <p className="hint warn">该账号已存在（{existLabel}）。是否用当前登录态覆盖更新？</p>
                                <button className="btn btn-primary btn-block" disabled={busy}
                                        onClick={() => doCapture(true)}>
                                    {busy ? '更新中…' : '覆盖更新为当前登录'}</button>
                            </>
                        ) : (
                            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => doCapture(false)}>
                                {busy ? '保存中…' : '保存当前登录'}</button>
                        )}
                    </>
                ) : (
                    <>
                        <div className="field">
                            <label>登录渠道</label>
                            <div className="provider-choices">
                                <button className={provider === 'zai' ? 'choice active' : 'choice'}
                                        onClick={() => setProvider('zai')}>z.ai（全球）</button>
                                <button className={provider === 'bigmodel' ? 'choice active' : 'choice'}
                                        onClick={() => setProvider('bigmodel')}>BigModel（中国）</button>
                            </div>
                        </div>
                        <p className="hint">点击打开浏览器登录。登录完成后浏览器会跳回本工具<b>自动完成</b>；
                            如果弹出「打开 ZCode」说明协议被官方客户端占用，点「取消」并复制地址栏链接粘贴到下方即可。</p>
                        <button className="btn btn-block" disabled={busy} onClick={async () => {
                            setBusy(true)
                            try {
                                await StartOAuth(provider, name, note)
                                setOauthOpened(true)
                            } catch (e) {
                                notify(String(e), 'error')
                            } finally {
                                setBusy(false)
                            }
                        }}>打开浏览器登录</button>
                        {oauthOpened && (
                            <>
                                <div className="field">
                                    <label>回调链接（zcode://…callback?code=… 或 authCode=…）</label>
                                    <textarea rows={3} value={callback}
                                              onChange={e => setCallback(e.target.value)}
                                              placeholder="zcode://zai-auth/callback?code=...&state=..."/>
                                </div>
                                <button className="btn btn-primary btn-block" disabled={busy || !callback.trim()}
                                        onClick={doFinishOAuth}>
                                    {busy ? '正在登录…（约20秒）' : '完成登录并保存'}</button>
                                <p className="hint">如果刚才已经跳转到了 ZCode 客户端但账号没变化，那是因为登录是从本工具发起的、
                                    ZCode 校验不通过。请在 ZCode 客户端里自行退出并登录新账号，成功后点下方按钮：</p>
                                <button className="btn btn-block" disabled={busy}
                                        onClick={() => doCapture(true)}>
                                    从 ZCode 抓取当前登录入库</button>
                            </>
                        )}
                    </>
                )}
                <button className="btn btn-block btn-ghost" onClick={() => {
                    CancelOAuth()
                    onClose()
                }}>取消</button>
            </div>
        </div>
    )
}

export default function App() {
    const [state, setState] = useState(null)
    const [showAdd, setShowAdd] = useState(false)
    const [showHelp, setShowHelp] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [showVersion, setShowVersion] = useState(false)
    const [showUpdate, setShowUpdate] = useState(false)
    // 显示设置（localStorage 持久化）：Start Plan 额度块显隐 + 重置时间显示模式 + 限额数值显隐
    const [showStartPlan, setShowStartPlan] = useState(() => localStorage.getItem('zcas.showStartPlan') !== '0')
    const [resetMode, setResetMode] = useState(() => localStorage.getItem('zcas.resetTimeMode') || 'remaining')
    const [showLimitNumbers, setShowLimitNumbers] = useState(() => localStorage.getItem('zcas.showLimitNumbers') !== '0')
    // 剩余时长模式下周期性触发重渲染，让「X小时Y分后重置」走字（静态数据本身不更新）
    const [, setTick] = useState(0)
    useEffect(() => {
        localStorage.setItem('zcas.showStartPlan', showStartPlan ? '1' : '0')
    }, [showStartPlan])
    useEffect(() => {
        localStorage.setItem('zcas.resetTimeMode', resetMode)
    }, [resetMode])
    useEffect(() => {
        localStorage.setItem('zcas.showLimitNumbers', showLimitNumbers ? '1' : '0')
    }, [showLimitNumbers])
    useEffect(() => {
        if (resetMode !== 'remaining') return
        const t = setInterval(() => setTick(v => v + 1), 30000)
        return () => clearInterval(t)
    }, [resetMode])
    const [info, setInfo] = useState(null) // 全局配置（名称/版本/仓库）
    const [toast, setToast] = useState(null)
    const [quotas, setQuotas] = useState({}) // key: 'current' 或账号 id → {loading, data, error}
    const [confirm, setConfirm] = useState(null) // {text, action}
    const [health, setHealth] = useState({}) // 账号 id → {status, checkedAt}
    const [reauthID, setReauthID] = useState(null) // 正在重新授权的账号 id
    const [weeklyView, setWeeklyView] = useState(null) // 周额度统计弹窗 {id, label}
    // oauth:error 事件监听注册一次，用 ref 读最新的 reauthID（避免闭包旧值）
    const reauthRef = useRef(null)
    reauthRef.current = reauthID

    const notify = useCallback((msg, type = 'ok') => {
        setToast({msg, type})
        setTimeout(() => setToast(null), 4000)
    }, [])

    const askConfirm = useCallback((text, action) => setConfirm({text, action}), [])

    // 查询额度（静默：失败只显示在行内，不弹 toast）
    const loadQuota = useCallback(async (key) => {
        setQuotas(q => ({...q, [key]: {loading: true, data: q[key]?.data, error: null}}))
        try {
            const data = await GetQuota(key === 'current' ? '' : key)
            setQuotas(q => ({...q, [key]: {loading: false, data}}))
        } catch (e) {
            setQuotas(q => ({...q, [key]: {loading: false, error: String(e)}}))
        }
    }, [])

    const refresh = useCallback(async () => {
        try {
            const s = await GetState()
            setState(s)
            // 自动加载额度
            if (s.current) loadQuota('current')
            ;(s.accounts || []).forEach(a => loadQuota(a.id))
        } catch (e) {
            notify(String(e), 'error')
        }
    }, [loadQuota, notify])

    // ===== 重新授权流程 =====
    const startReauth = useCallback(async (id) => {
        await StartReOAuth(id)
        setReauthID(id)
        notify('已打开浏览器，完成授权后会自动更新登录态')
    }, [notify])

    const finishReauth = useCallback(async (input) => {
        const r = await FinishReOAuth(input) // 失败抛错（身份不一致等），保留等待状态让用户重试
        setReauthID(null)
        notify(reauthDoneMsg(r.meta?.label || '账号', r.liveRefreshed, r.zcodeRestarted))
        refresh()
    }, [notify, refresh])

    const cancelReauth = useCallback(async () => {
        try {
            await CancelOAuth()
        } catch (e) { /* 忽略 */ }
        setReauthID(null)
    }, [])

    // 打开周额度周期统计弹窗（id 为空 = 当前登录账号）
    const openWeekly = useCallback((id, label) => setWeeklyView({id, label}), [])

    useEffect(() => {
        refresh()
        GetAppInfo().then(setInfo).catch(() => {})
        // 会话健康：先显示缓存，再后台探测刷新（结果也由保活巡检事件推送）
        GetHealth().then(l => setHealth(indexHealth(l))).catch(() => {})
        CheckHealthNow().then(l => setHealth(indexHealth(l))).catch(() => {})
        // 菜单栏「帮助 → 检查更新 / 关于」（非 macOS 平台有「关于」项）
        const offUpdate = EventsOn('menu:check-update', () => setShowUpdate(true))
        const offAbout = EventsOn('menu:about', () => setShowVersion(true))
        const offHealth = EventsOn('health:updated', l => setHealth(indexHealth(l)))
        // 重新授权协议回调自动完成（r.reauth 标记区分于添加账号）
        const offOauthDone = EventsOn('oauth:done', r => {
            if (!r?.reauth) return
            setReauthID(null)
            notify(reauthDoneMsg(r.label, r.liveRefreshed, r.zcodeRestarted))
            refresh()
        })
        const offOauthErr = EventsOn('oauth:error', msg => {
            if (reauthRef.current != null) notify(String(msg), 'error') // 添加账号弹窗有自己的错误提示
        })
        return () => {
            offUpdate()
            offAbout()
            offHealth()
            offOauthDone()
            offOauthErr()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh])

    const currentId = state?.current?.savedId || null
    const showGuestRow = state?.current && !currentId

    return (
        <div className="container">
            <header className="topbar">
                <h1>ZCode 账号切换</h1>
                <span className={state?.running ? 'status on' : 'status off'}>
                    {state?.running ? '● ZCode 运行中' : '○ ZCode 已关闭'}
                </span>
                <div className="spacer"/>
                {state?.hasLastBackup &&
                    <button className="btn" onClick={() => askConfirm('回滚到切换前的登录态？', async () => {
                        try {
                            await Rollback()
                            notify('已回滚')
                            refresh()
                        } catch (e) {
                            notify(String(e), 'error')
                        }
                    })}>回滚</button>}
                <button className="btn btn-icon" title="刷新账号列表与额度" aria-label="刷新" onClick={refresh}>
                    <Icon d={ICONS.refresh}/>
                </button>
                <button className="btn btn-icon" title="显示设置" aria-label="显示设置" onClick={() => setShowSettings(true)}>
                    <Icon d={ICONS.settings}/>
                </button>
                <button className="btn btn-icon btn-primary" title="添加账号" aria-label="添加账号"
                        onClick={() => setShowAdd(true)}>
                    <Icon d={ICONS.userPlus}/>
                </button>
                <button className="btn btn-help" title="字段说明" onClick={() => setShowHelp(true)}>ⓘ</button>
            </header>

            <main className="list">
                {showGuestRow &&
                    <CurrentGuestRow current={state.current}
                                     quotaState={quotas['current']}
                                     onRefreshQuota={loadQuota}
                                     onSave={() => setShowAdd(true)}
                                     showStartPlan={showStartPlan}
                                     resetMode={resetMode}
                                     showLimitNumbers={showLimitNumbers}
                                     onOpenWeekly={openWeekly}/>}
                {state?.accounts?.map(m => (
                    <AccountRow key={m.id} meta={m}
                                isCurrent={currentId === m.id}
                                quotaState={quotas[m.id]}
                                onRefreshQuota={loadQuota}
                                onAction={refresh} notify={notify} askConfirm={askConfirm}
                                health={health[m.id]}
                                reauthActive={reauthID === m.id}
                                onStartReauth={startReauth}
                                onFinishReauth={finishReauth}
                                onCancelReauth={cancelReauth}
                                showStartPlan={showStartPlan}
                                resetMode={resetMode}
                                showLimitNumbers={showLimitNumbers}
                                onOpenWeekly={openWeekly}/>
                ))}
                {!showGuestRow && state?.accounts?.length === 0 &&
                    <p className="empty">还没有保存的账号。点击右上角「添加账号」，或在 ZCode 登录后使用「抓取当前登录」。</p>}
            </main>

            {showHelp && <HelpModal onClose={() => setShowHelp(false)}/>}
            {showSettings && <SettingsModal showStartPlan={showStartPlan}
                                            onToggleStartPlan={setShowStartPlan}
                                            resetMode={resetMode}
                                            onResetMode={setResetMode}
                                            showLimitNumbers={showLimitNumbers}
                                            onToggleLimitNumbers={setShowLimitNumbers}
                                            onClose={() => setShowSettings(false)}/>}
            {weeklyView && <WeeklyModal id={weeklyView.id} label={weeklyView.label}
                                        onClose={() => setWeeklyView(null)}/>}
            {showVersion && info && <VersionModal info={info} onClose={() => setShowVersion(false)}/>}
            {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)}/>}
            {showAdd && <AddAccountModal onClose={() => setShowAdd(false)}
                                         onDone={() => {
                                             setShowAdd(false)
                                             refresh()
                                         }}
                                         notify={notify}/>}
            {confirm && <ConfirmDialog text={confirm.text}
                                       onOk={() => {
                                           const act = confirm.action
                                           setConfirm(null)
                                           act()
                                       }}
                                       onCancel={() => setConfirm(null)}/>}
            {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
        </div>
    )
}
