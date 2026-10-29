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
	"strings"
	"time"

	"zcas/internal/fingerprint"
	"zcas/internal/fsutil"
	"zcas/internal/paths"
	"zcas/internal/store"
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

// WeeklyStats 周额度消耗统计（挂到 Overview.Weekly 返回给前端）。
type WeeklyStats struct {
	// 本次周额度（当前周期）
	Current *WeeklyCurrentStat `json:"current,omitempty"`
	// 历史周额度（已完成周期的平均）
	Historical *WeeklyHistoryStat `json:"historical,omitempty"`
	// 本月（自然月）累计消耗，官方按天积分口径
	Monthly *MonthlyStat `json:"monthly,omitempty"`
}

// MonthlyStat 自然月累计消耗。套餐无独立月度上限（额度按 7 天周期滚动、不随自然月
// 重置），LimitCredits 为按周额度折算的月上限（周限额 × 当月天数 ÷ 7），
// Percent / ProjectedPercent 均基于该折算口径。
type MonthlyStat struct {
	Month        string  `json:"month"`        // 2026-10
	Credits      float64 `json:"credits"`      // 本月累计积分
	DailyAvg     float64 `json:"dailyAvg"`     // 日均（按自然月已过天数）
	Days         int     `json:"days"`         // 有数据的天数
	LimitCredits float64 `json:"limitCredits"` // 折算月上限（0=周限额未知）
	Percent      float64 `json:"percent"`      // 已用百分比（折算口径）
	// ProjectedPercent 按当前节奏预计全月消耗 = 日均 × 当月天数 ÷ 折算上限。
	ProjectedPercent float64 `json:"projectedPercent"`
}

// buildMonthlyStat 从官方按天积分统计自然月累计；无数据返回 nil。
func buildMonthlyStat(daily map[string]float64, weeklyLimit float64) *MonthlyStat {
	if len(daily) == 0 {
		return nil
	}
	now := time.Now()
	month := now.Format("2006-01")
	var sum float64
	var days int
	for d, v := range daily {
		if strings.HasPrefix(d, month) {
			sum += v
			days++
		}
	}
	if days == 0 {
		return nil
	}
	daysInMonth := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day()
	m := &MonthlyStat{
		Month:   month,
		Credits: sum,
		Days:    days,
	}
	elapsed := now.Day()
	if elapsed < 1 {
		elapsed = 1
	}
	m.DailyAvg = sum / float64(elapsed)
	if weeklyLimit > 0 {
		m.LimitCredits = weeklyLimit * float64(daysInMonth) / 7
		m.Percent = clamp(sum/m.LimitCredits*100, 0, 100)
		m.ProjectedPercent = m.DailyAvg * float64(daysInMonth) / m.LimitCredits * 100
	}
	return m
}

// WeeklyCurrentStat 本次周额度的消耗节奏。
type WeeklyCurrentStat struct {
	Start        int64   `json:"start"`        // 本周期开始时间（毫秒）
	End          int64   `json:"end"`          // 重置时间（毫秒）
	DaysElapsed  float64 `json:"daysElapsed"`  // 已过天数
	Percent      float64 `json:"percent"`      // 当前已用百分比
	DailyPercent float64 `json:"dailyPercent"` // 平均每天消耗（百分比/天）
	// ProjectedPercent 按当前节奏预计本周期总消耗 = 日均 × 7 天（>100 表示会提前用完）。
	ProjectedPercent float64 `json:"projectedPercent"`
}

// WeeklyHistoryStat 历史周额度的平均消耗（完整周期口径）。
type WeeklyHistoryStat struct {
	Cycles       int     `json:"cycles"`       // 参与统计的历史周期数
	DailyPercent float64 `json:"dailyPercent"` // 历史平均每天消耗（百分比/天）
	// WeeklyPercent 平均每周消耗 = 各完整周期期末已用百分比的均值。
	WeeklyPercent float64 `json:"weeklyPercent"`
}

type weeklyHistoryFile struct {
	Version  int `json:"version"`
	Accounts map[string]*weeklyAccountHistory `json:"accounts"`
}

type weeklyAccountHistory struct {
	Cycles []*weekCycle `json:"cycles"` // 按周期开始时间升序
	// DailyCredits/DailyTokens 官方按天积分/token（date → 值，credit-usage/activity 同步）。
	DailyCredits     map[string]float64 `json:"dailyCredits,omitempty"`
	DailyTokens      map[string]int64   `json:"dailyTokens,omitempty"`
	StreakDays       int                `json:"streakDays,omitempty"`       // 官方活跃度：当前连续使用天数
	LongestStreakDays int               `json:"longestStreakDays,omitempty"`
	CreditsSyncAt    int64              `json:"creditsSyncAt,omitempty"` // 官方数据最近同步时间（毫秒）
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
	historyMu.Lock()
	defer historyMu.Unlock()
	h := loadWeeklyHistory()
	if _, ok := h.Accounts[accountKey]; !ok {
		return
	}
	delete(h.Accounts, accountKey)
	saveWeeklyHistory(h)
}

// WeeklyCycle 一个周额度周期的统计行（明细用）。
type WeeklyCycle struct {
	Start      int64   `json:"start"`      // 周期开始（毫秒）
	End        int64   `json:"end"`        // 重置时间（毫秒）
	FinalPct   float64 `json:"finalPct"`   // 期末已用%（官方积分口径优先，回退采样）
	UsedCredits float64 `json:"usedCredits"` // 周期内官方积分消耗（0=无官方数据）
	LimitCredits float64 `json:"limitCredits"` // 周期额度上限（采样 Total；0=未知）
	SampleDays int     `json:"sampleDays"` // 覆盖采样天数
	Active     bool    `json:"active"`     // 进行中（尚未到重置时间）
}

// WeeklyReport 周额度统计报告（统计弹窗 / CLI 用）。
type WeeklyReport struct {
	Cycles            []WeeklyCycle `json:"cycles"`            // 最新在前（含进行中）
	StreakDays        int           `json:"streakDays"`        // 官方活跃度：当前连续使用天数
	LongestStreakDays int           `json:"longestStreakDays"` // 最长连续使用天数
	SyncedAt          int64         `json:"syncedAt,omitempty"`// 官方数据最近同步时间（毫秒）
}

// cycleLimitCredits 从周期采样中取额度上限（最后一条的 Total）。
func cycleLimitCredits(c *weekCycle) float64 {
	for i := len(c.Samples) - 1; i >= 0; i-- {
		if c.Samples[i].Total > 0 {
			return c.Samples[i].Total
		}
	}
	return 0
}

// cycleCreditsSum 官方按天积分在周期 [start, end) 内的求和。
// 周期边界多在日内某时刻（如 16:36），边界日按时间占比加权：
// 起始日只算周期开始后的部分，结束日只算周期结束前的部分。
func cycleCreditsSum(daily map[string]float64, c *weekCycle) float64 {
	if len(daily) == 0 {
		return 0
	}
	start := time.UnixMilli(c.Start)
	end := time.UnixMilli(c.End)
	dayFrac := func(t time.Time) float64 {
		return float64(t.Hour()*3600+t.Minute()*60+t.Second()) / 86400
	}
	startDay := start.Format("2006-01-02")
	endDay := end.Format("2006-01-02")
	var sum float64
	for d, v := range daily {
		switch {
		case d > startDay && d < endDay:
			sum += v
		case d == startDay:
			sum += v * (1 - dayFrac(start))
		case d == endDay:
			sum += v * dayFrac(end)
		}
	}
	return sum
}

// weekSynthFromDaily 用官方按天积分重建历史周周期：锚定 anchorEnd（当前重置时间）
// 逐周前推，每个桶 [start, end) 覆盖天数不足 6 天的跳过（数据窗口边缘），
// 与已跟踪周期重叠（End 相差 <6 天，含当前进行中的周期）的跳过，避免重复统计。
func weekSynthFromDaily(daily map[string]float64, anchorEnd int64, trackedEnds []int64) []*weekCycle {
	if len(daily) == 0 || anchorEnd <= 0 {
		return nil
	}
	earliest := ""
	for d := range daily {
		if earliest == "" || d < earliest {
			earliest = d
		}
	}
	var out []*weekCycle
	end := anchorEnd
	for i := 0; i < 30; i++ {
		start := end - weekWindow.Milliseconds()
		startDay := time.UnixMilli(start).Format("2006-01-02")
		endDay := time.UnixMilli(end).Format("2006-01-02")
		if endDay <= earliest {
			break // 整个周期早于数据覆盖
		}
		cover := 0
		for d := range daily {
			if d >= startDay && d < endDay {
				cover++
			}
		}
		if cover >= 6 {
			dup := false
			for _, te := range trackedEnds {
				if te > end-6*dayMs && te < end+6*dayMs {
					dup = true
					break
				}
			}
			if !dup {
				out = append(out, &weekCycle{Start: start, End: end})
			}
		}
		end = start
	}
	return out
}

// coverDays 官方按天数据在某日期区间 [startDay, endDay) 内的覆盖天数。
func coverDays(daily map[string]float64, startDay, endDay string) int {
	n := 0
	for d := range daily {
		if d >= startDay && d < endDay {
			n++
		}
	}
	return n
}

// WeeklyReport 汇总某账号的周额度周期明细与活跃度；无记录返回空报告。
func BuildWeeklyReport(accountKey string) *WeeklyReport {
	h := loadWeeklyHistory()
	acc := h.Accounts[accountKey]
	rep := &WeeklyReport{}
	if acc == nil {
		return rep
	}
	now := time.Now().UnixMilli()
	rep.StreakDays = acc.StreakDays
	rep.LongestStreakDays = acc.LongestStreakDays
	rep.SyncedAt = acc.CreditsSyncAt
	rep.Cycles = make([]WeeklyCycle, 0, len(acc.Cycles))
	var trackedEnds []int64
	var anchor int64
	var knownLimit float64
	for _, c := range acc.Cycles {
		trackedEnds = append(trackedEnds, c.End)
		if c.End > anchor {
			anchor = c.End
		}
		if lim := cycleLimitCredits(c); lim > 0 {
			knownLimit = lim
		}
	}
	for _, c := range acc.Cycles {
		if len(c.Samples) == 0 {
			continue
		}
		used := cycleCreditsSum(acc.DailyCredits, c)
		limit := cycleLimitCredits(c)
		pct := c.Samples[len(c.Samples)-1].Percent
		if used > 0 && limit > 0 {
			pct = used / limit * 100 // 官方积分口径更准（覆盖未打开工具的日子）
		}
		rep.Cycles = append(rep.Cycles, WeeklyCycle{
			Start:       c.Start,
			End:         c.End,
			FinalPct:    pct,
			UsedCredits: used,
			LimitCredits: limit,
			SampleDays:  len(c.Samples),
			Active:      c.End > now,
		})
	}
	// 官方按天积分重建未被跟踪的历史周期（采样开始之前的周也有明细）
	if anchor > 0 && len(acc.DailyCredits) > 0 && knownLimit > 0 {
		for _, sc := range weekSynthFromDaily(acc.DailyCredits, anchor, trackedEnds) {
			used := cycleCreditsSum(acc.DailyCredits, sc)
			if used <= 0 {
				continue // 整周未使用的周期不计入
			}
			rep.Cycles = append(rep.Cycles, WeeklyCycle{
				Start:        sc.Start,
				End:          sc.End,
				FinalPct:     used / knownLimit * 100,
				UsedCredits:  used,
				LimitCredits: knownLimit,
				SampleDays:   coverDays(acc.DailyCredits, time.UnixMilli(sc.Start).Format("2006-01-02"), time.UnixMilli(sc.End).Format("2006-01-02")),
				Active:       false,
			})
		}
	}
	// 最新在前
	sort.Slice(rep.Cycles, func(i, j int) bool { return rep.Cycles[i].Start > rep.Cycles[j].Start })
	return rep
}

// ===== 采样 + 统计 =====

// AccountKey 从登录态凭据提取周额度历史的账号键。
// 取指纹的 EmailShortID 并归一到已保存账号的 ID（见 MatchSavedAccount），
// 保证「当前登录」与「已保存账号」两条查询路径共用同一段历史。
func AccountKey(cred, cfg map[string]any, secret string) string {
	fp := fingerprint.Extract(cred, cfg, secret)
	if fp == nil {
		return ""
	}
	if id := MatchSavedAccount(fp); id != "" {
		return id
	}
	return fp.EmailShortID
}

// MatchSavedAccount 把账号指纹匹配到已保存账号：精确 EmailShortID 优先；
// 弱指纹/资料字段变化（如保存时有邮箱、现在没有）导致 ID 漂移时，
// 按 UserID（JWT user_id，最稳定）与邮箱回退匹配。未匹配返回空。
func MatchSavedAccount(fp *fingerprint.Fingerprint) string {
	if fp == nil {
		return ""
	}
	if store.Exists(fp.EmailShortID) {
		return fp.EmailShortID
	}
	metas, err := store.List()
	if err != nil {
		return ""
	}
	for _, m := range metas {
		if fp.UserID != "" && m.UserID != "" && fp.UserID == m.UserID {
			return m.ID
		}
	}
	for _, m := range metas {
		if fp.Email != "" && m.Email != "" && strings.EqualFold(fp.Email, m.Email) {
			return m.ID
		}
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

	historyMu.Lock()
	defer historyMu.Unlock()

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
	st.Monthly = buildMonthlyStat(acc.DailyCredits, l.Limit)
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
		daily := pct / days
		st.Current = &WeeklyCurrentStat{
			Start:            start,
			End:              end,
			DaysElapsed:      days,
			Percent:          pct,
			DailyPercent:     daily,
			ProjectedPercent: daily * 7,
		}
	}
	// 历史周期：优先用官方按天积分重建（采样开始之前的周也参与，立即有值）；
	// 无官方数据时回退到已跟踪的采样周期（期末已用% 口径）
	var sum, sumPct float64
	var n int
	if len(acc.DailyCredits) > 0 && l.Limit > 0 {
		var trackedEnds []int64
		for _, c := range acc.Cycles {
			trackedEnds = append(trackedEnds, c.End)
		}
		for _, sc := range weekSynthFromDaily(acc.DailyCredits, end, trackedEnds) {
			used := cycleCreditsSum(acc.DailyCredits, sc)
			if used <= 0 {
				continue // 整周未使用的周期不参与平均（会稀释真实消耗）
			}
			pct := used / l.Limit * 100
			sum += pct / 7
			sumPct += pct
			n++
		}
	}
	if n == 0 {
		for _, c := range acc.Cycles {
			if c.End > now || len(c.Samples) == 0 {
				continue
			}
			last := c.Samples[len(c.Samples)-1]
			if last.Percent <= 0 {
				continue
			}
			sum += last.Percent / 7
			sumPct += last.Percent
			n++
		}
	}
	if n > 0 {
		st.Historical = &WeeklyHistoryStat{
			Cycles:        n,
			DailyPercent:  sum / float64(n),
			WeeklyPercent: sumPct / float64(n),
		}
	}
	return st
}
