package quota

// 周额度历史采样与日均消耗统计。
//
// 接口只给每周限额的重置时间（nextReset），周期窗口固定 7 天，
// 因此周期开始时间 = 重置时间 - 7 天（反算）。每次查询额度把「每周」限额
// 采样到本地（~/.zcas/quota-history.json），据此算两个指标：
//   - 本次周额度日均 = 当前已用% ÷ 本周期已过天数（按天实时）
//   - 历史周额度日均 = 各已完成周期的 期末已用% ÷ 7 的平均
//
// 采样按天去重（同一天只留最新一条），已完成且无样本的周期不保留，
// 历史周期最多保留 maxHistoryCycles 个，防止文件无限增长。

import (
	"encoding/json"
	"os"
	"sort"
	"time"

	"zcas/internal/fingerprint"
	"zcas/internal/fsutil"
	"zcas/internal/paths"
)

const (
	weekWindow     = 7 * 24 * time.Hour // 每周限额的周期窗口
	dayMs          = int64(24 * time.Hour / time.Millisecond)
	maxHistoryCycles = 13 // 保留约一个季度的历史周期
	minDaysElapsed = 0.04 // 约 1 小时，防止刚重置时除以接近 0 的天数
)

// weekSample 一次周额度采样。
type weekSample struct {
	T       int64   `json:"t"`           // 采样时间（毫秒）
	Percent float64 `json:"percent"`     // 已用百分比
	Used    float64 `json:"used"`        // 已用量
	Total   float64 `json:"total"`       // 周总额
}

// weekCycle 一个周额度周期（按重置时间唯一）。
type weekCycle struct {
	Start   int64        `json:"start"` // 周期开始 = 重置时间 - 7天（毫秒，反算）
	End     int64        `json:"end"`   // 重置时间（毫秒）
	Samples []weekSample `json:"samples"`
}

// WeeklyStats 周额度日均消耗统计（挂到 Overview.Weekly 返回给前端）。
type WeeklyStats struct {
	// 本次周额度（当前周期）
	Current *WeeklyCurrentStat `json:"current,omitempty"`
	// 历史周额度（已完成周期的平均）
	Historical *WeeklyHistoryStat `json:"historical,omitempty"`
}

// WeeklyCurrentStat 本次周额度的日均消耗。
type WeeklyCurrentStat struct {
	Start        int64   `json:"start"`        // 本周期开始时间（毫秒）
	End          int64   `json:"end"`          // 重置时间（毫秒）
	DaysElapsed  float64 `json:"daysElapsed"`  // 已过天数
	Percent      float64 `json:"percent"`      // 当前已用百分比
	DailyPercent float64 `json:"dailyPercent"` // 平均每天消耗（百分比/天）
}

// WeeklyHistoryStat 历史周额度的日均消耗。
type WeeklyHistoryStat struct {
	Cycles       int     `json:"cycles"`       // 参与统计的历史周期数
	DailyPercent float64 `json:"dailyPercent"` // 历史平均每天消耗（百分比/天）
}

type weeklyHistoryFile struct {
	Version  int `json:"version"`
	Accounts map[string]*weeklyAccountHistory `json:"accounts"`
}

type weeklyAccountHistory struct {
	Cycles []*weekCycle `json:"cycles"` // 按周期开始时间升序
}

// weeklyLimit 取 Overview 里「每周」限额（Coding Plan 的周窗口，unit=6）。
func weeklyLimit(ov *Overview) *CodingPlanLimit {
	if ov == nil || ov.CodingPlan == nil {
		return nil
	}
	for i := range ov.CodingPlan.Limits {
		if ov.CodingPlan.Limits[i].Name == "每周" {
			return &ov.CodingPlan.Limits[i]
		}
	}
	return nil
}

// toMs nextResetTime 兼容秒/毫秒两种数量级（与前端 fmtDate 的兜底一致）。
func toMs(ts int64) int64 {
	if ts > 0 && ts < 1e12 {
		return ts * 1000
	}
	return ts
}

// ===== 本地读写 =====

func loadWeeklyHistory() *weeklyHistoryFile {
	h := &weeklyHistoryFile{Version: 1}
	b, err := os.ReadFile(paths.QuotaHistoryFile())
	if err == nil {
		_ = json.Unmarshal(b, h)
	}
	if h.Accounts == nil {
		h.Accounts = map[string]*weeklyAccountHistory{}
	}
	return h
}

func saveWeeklyHistory(h *weeklyHistoryFile) {
	b, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		return
	}
	_ = fsutil.WriteFileAtomic(paths.QuotaHistoryFile(), b, 0o600)
}

// ForgetWeekly 删除账号时清理其周额度历史。
func ForgetWeekly(accountKey string) {
	h := loadWeeklyHistory()
	if _, ok := h.Accounts[accountKey]; !ok {
		return
	}
	delete(h.Accounts, accountKey)
	saveWeeklyHistory(h)
}

// ===== 采样 + 统计 =====

// AccountKey 从登录态凭据提取周额度历史的账号键。
// 取指纹的 EmailShortID（邮箱hash > 手机号hash > uid 前8位），与账号快照 ID 同源，
// 因此「当前登录」与「已保存账号」两条查询路径天然共用同一段历史。
func AccountKey(cred map[string]any, secret string) string {
	if fp := fingerprint.Extract(cred, nil, secret); fp != nil {
		return fp.EmailShortID
	}
	return ""
}

// TrackWeekly 把本次查询的「每周」限额采样进本地历史，并计算本次/历史两个
// 日均消耗指标挂到 ov.Weekly。任何失败都静默（附加功能，不影响额度主流程）。
func TrackWeekly(accountKey string, ov *Overview) {
	if accountKey == "" {
		return
	}
	l := weeklyLimit(ov)
	if l == nil {
		return // 无周额度数据（非周窗口套餐/查询静默失败），不动历史
	}
	end := toMs(l.NextReset)
	if end <= 0 {
		return
	}
	now := time.Now().UnixMilli()

	h := loadWeeklyHistory()
	acc := h.Accounts[accountKey]
	if acc == nil {
		acc = &weeklyAccountHistory{}
		h.Accounts[accountKey] = acc
	}

	// 找到本周期（按重置时间匹配）；没有则开新周期
	var cur *weekCycle
	for _, c := range acc.Cycles {
		if c.End == end {
			cur = c
			break
		}
	}
	if cur == nil {
		cur = &weekCycle{Start: end - weekWindow.Milliseconds(), End: end}
		acc.Cycles = append(acc.Cycles, cur)
		sort.Slice(acc.Cycles, func(i, j int) bool { return acc.Cycles[i].Start < acc.Cycles[j].Start })
	}

	// 追加采样，同一天只留最新一条
	bucket := now / dayMs
	kept := cur.Samples[:0]
	for _, s := range cur.Samples {
		if s.T/dayMs != bucket {
			kept = append(kept, s)
		}
	}
	cur.Samples = append(kept, weekSample{T: now, Percent: float64(l.Percent), Used: l.Used, Total: l.Limit})

	pruneCycles(acc, now)
	saveWeeklyHistory(h)

	ov.Weekly = buildStats(acc, l, now)
}

// pruneCycles 清理已完成且无样本、以及超出保留数量的历史周期。
func pruneCycles(acc *weeklyAccountHistory, now int64) {
	kept := acc.Cycles[:0]
	for _, c := range acc.Cycles {
		if c.End <= now && len(c.Samples) == 0 {
			continue // 已结束却没有任何采样，无统计价值
		}
		kept = append(kept, c)
	}
	// 只留最近 maxHistoryCycles 个已完成的周期 + 当前进行中的
	var completed []*weekCycle
	var active *weekCycle
	for _, c := range kept {
		if c.End <= now {
			completed = append(completed, c)
		} else {
			active = c
		}
	}
	if len(completed) > maxHistoryCycles {
		completed = completed[len(completed)-maxHistoryCycles:]
	}
	acc.Cycles = acc.Cycles[:0]
	acc.Cycles = append(acc.Cycles, completed...)
	if active != nil {
		acc.Cycles = append(acc.Cycles, active)
	}
}

// buildStats 计算本次/历史日均消耗。
func buildStats(acc *weeklyAccountHistory, l *CodingPlanLimit, now int64) *WeeklyStats {
	end := toMs(l.NextReset)
	st := &WeeklyStats{}
	if end > 0 {
		start := end - weekWindow.Milliseconds()
		days := float64(now-start) / float64(dayMs)
		if days < minDaysElapsed {
			days = minDaysElapsed
		}
		if days > 7 {
			days = 7
		}
		pct := float64(l.Percent)
		st.Current = &WeeklyCurrentStat{
			Start:        start,
			End:          end,
			DaysElapsed:  days,
			Percent:      pct,
			DailyPercent: pct / days,
		}
	}
	// 历史周期：期末已用% ÷ 7 天
	var sum float64
	var n int
	for _, c := range acc.Cycles {
		if c.End > now || len(c.Samples) == 0 {
			continue
		}
		last := c.Samples[len(c.Samples)-1]
		if last.Percent <= 0 {
			continue // 整周没动过的周期不参与平均（会稀释真实消耗）
		}
		sum += last.Percent / 7
		n++
	}
	if n > 0 {
		st.Historical = &WeeklyHistoryStat{Cycles: n, DailyPercent: sum / float64(n)}
	}
	return st
}
