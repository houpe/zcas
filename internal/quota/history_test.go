package quota

// 周额度历史采样与日均消耗统计的单元测试。
// TrackWeekly 内部取 time.Now()，测试里用相对 now 的重置时间构造各场景。

import (
	"fmt"
	"encoding/json"
	"os"
	"testing"
	"time"

	"zcas/internal/fingerprint"
	"zcas/internal/paths"
	"zcas/internal/store"
)

func useTempDataDir(t *testing.T) {
	t.Helper()
	t.Setenv("ZCAS_DATA_DIR", t.TempDir())
}

func ms(d time.Duration) int64 { return time.Now().Add(d).UnixMilli() }

func weeklyOV(percent int, used, limit float64, nextResetMs int64) *Overview {
	return &Overview{CodingPlan: &CodingPlanUsage{
		Provider: "bigmodel",
		Limits: []CodingPlanLimit{
			{Name: "每5小时", Percent: 10, Used: 3, Limit: 30, NextReset: ms(2 * time.Hour)},
			{Name: "每周", Percent: percent, Used: used, Limit: limit, NextReset: nextResetMs},
		},
	}}
}

func TestTrackWeeklyCurrentCycle(t *testing.T) {
	useTempDataDir(t)
	// 周期还剩 3 天：开始 = end-7d，已过 4 天，日均 = 40/4 = 10%/天
	ov := weeklyOV(40, 40, 100, ms(72*time.Hour))
	TrackWeekly("acc1", ov)
	if ov.Weekly == nil || ov.Weekly.Current == nil {
		t.Fatalf("期望返回本次统计，got %+v", ov.Weekly)
	}
	c := ov.Weekly.Current
	if got := c.DaysElapsed; got < 3.9 || got > 4.1 {
		t.Errorf("已过天数 ≈ 4，got %v", got)
	}
	if got := c.DailyPercent; got < 9.8 || got > 10.2 {
		t.Errorf("日均 ≈ 10%%/天，got %v", got)
	}
	if got := c.ProjectedPercent; got < 68.6 || got > 71.4 {
		t.Errorf("预计本周 ≈ 10×7 = 70，got %v", got)
	}
	if ov.Weekly.Historical != nil {
		t.Errorf("首个周期不应有历史统计，got %+v", ov.Weekly.Historical)
	}
}

func TestTrackWeeklySameDayDedup(t *testing.T) {
	useTempDataDir(t)
	reset := ms(48 * time.Hour)
	TrackWeekly("acc1", weeklyOV(10, 10, 100, reset))
	TrackWeekly("acc1", weeklyOV(20, 20, 100, reset))
	h := loadWeeklyHistory()
	acc := h.Accounts["acc1"]
	if acc == nil || len(acc.Cycles) != 1 {
		t.Fatalf("应只有一个周期，got %+v", acc)
	}
	if len(acc.Cycles[0].Samples) != 1 {
		t.Errorf("同一天应去重只留最新一条，got %d 条", len(acc.Cycles[0].Samples))
	}
	if acc.Cycles[0].Samples[0].Percent != 20 {
		t.Errorf("应保留最新采样值 20，got %v", acc.Cycles[0].Samples[0].Percent)
	}
}

func TestTrackWeeklyHistoricalAverage(t *testing.T) {
	useTempDataDir(t)
	// 周期 A：已结束 1 天，期末用 70% → 日均 10
	TrackWeekly("acc1", weeklyOV(70, 70, 100, ms(-24*time.Hour)))
	// 周期 B：已结束 1 天，整周没用（0%）→ 不计入
	TrackWeekly("acc1", weeklyOV(0, 0, 100, ms(-24*time.Hour-7*24*time.Hour)))
	// 当前周期：剩 3 天，已用 40%
	ov := weeklyOV(40, 40, 100, ms(72*time.Hour))
	TrackWeekly("acc1", ov)

	if ov.Weekly.Historical == nil {
		t.Fatalf("应有历史统计")
	}
	h := ov.Weekly.Historical
	if h.Cycles != 1 {
		t.Errorf("只有 1 个有效历史周期（0%% 的不计），got %d", h.Cycles)
	}
	if got := h.DailyPercent; got < 9.9 || got > 10.1 {
		t.Errorf("历史日均 ≈ 70/7 = 10，got %v", got)
	}
	if got := h.WeeklyPercent; got < 69.9 || got > 70.1 {
		t.Errorf("平均每周 ≈ 70（唯一周期期末 70%%），got %v", got)
	}
	if ov.Weekly.Current == nil || ov.Weekly.Current.DailyPercent < 9.8 || ov.Weekly.Current.DailyPercent > 10.2 {
		t.Errorf("本次日均应 ≈ 40/4 = 10，got %+v", ov.Weekly.Current)
	}
}

func TestTrackWeeklySkips(t *testing.T) {
	useTempDataDir(t)
	// 无 coding plan
	ov := &Overview{}
	TrackWeekly("acc1", ov)
	if ov.Weekly != nil {
		t.Errorf("无 coding plan 不应产生统计")
	}
	// 只有 5 小时限额、无每周
	ov = &Overview{CodingPlan: &CodingPlanUsage{Limits: []CodingPlanLimit{
		{Name: "每5小时", Percent: 10, NextReset: ms(time.Hour)},
	}}}
	TrackWeekly("acc1", ov)
	if ov.Weekly != nil {
		t.Errorf("无每周限额不应产生统计")
	}
	// 每周限额缺重置时间
	ov = &Overview{CodingPlan: &CodingPlanUsage{Limits: []CodingPlanLimit{
		{Name: "每周", Percent: 10},
	}}}
	TrackWeekly("acc1", ov)
	if ov.Weekly != nil {
		t.Errorf("缺重置时间不应产生统计")
	}
	// 空账号键
	ov = weeklyOV(10, 10, 100, ms(24*time.Hour))
	TrackWeekly("", ov)
	if ov.Weekly != nil {
		t.Errorf("空账号键不应统计")
	}
}

func TestTrackWeeklyPruneAndForget(t *testing.T) {
	useTempDataDir(t)
	// 造 20 个已完成周期（每周一条，全部有用量）+ 1 个当前周期
	now := time.Now()
	for i := 20; i >= 1; i-- {
		end := now.Add(time.Duration(-i*7*24) * time.Hour).UnixMilli()
		TrackWeekly("acc1", weeklyOV(35, 35, 100, end))
	}
	ov := weeklyOV(35, 35, 100, ms(48*time.Hour))
	TrackWeekly("acc1", ov)

	h := loadWeeklyHistory()
	acc := h.Accounts["acc1"]
	// maxHistoryCycles=13 已完成 + 1 进行中
	if len(acc.Cycles) != maxHistoryCycles+1 {
		t.Errorf("应保留 %d 个周期（13 历史 + 1 当前），got %d", maxHistoryCycles+1, len(acc.Cycles))
	}
	if ov.Weekly.Historical == nil || ov.Weekly.Historical.Cycles != maxHistoryCycles {
		t.Errorf("历史统计应含 13 个周期，got %+v", ov.Weekly.Historical)
	}

	ForgetWeekly("acc1")
	if _, ok := loadWeeklyHistory().Accounts["acc1"]; ok {
		t.Errorf("ForgetWeekly 后应无残留")
	}
	ForgetWeekly("不存在") // 不应报错
}

func TestTrackWeeklyFilePersist(t *testing.T) {
	useTempDataDir(t)
	TrackWeekly("acc1", weeklyOV(25, 25, 100, ms(24*time.Hour)))
	b, err := os.ReadFile(paths.QuotaHistoryFile())
	if err != nil {
		t.Fatalf("历史文件应已写入: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("历史文件应为合法 JSON: %v", err)
	}
	if raw["version"] != float64(1) {
		t.Errorf("version 应为 1，got %v", raw["version"])
	}
	if _, ok := raw["accounts"].(map[string]any)["acc1"]; !ok {
		t.Errorf("应包含 acc1 的历史")
	}
}

func TestBuildWeeklyReport(t *testing.T) {
	useTempDataDir(t)
	now := time.Now()
	// 已完成周期（1 天前结束，采样 70%，额度 100）
	TrackWeekly("acc1", weeklyOV(70, 70, 100, now.Add(-24*time.Hour).UnixMilli()))
	// 当前周期（剩 3 天，已用 40%）
	TrackWeekly("acc1", weeklyOV(40, 40, 100, now.Add(72*time.Hour).UnixMilli()))
	// 注入官方按天积分（构造 history 直接写：周期 A 内 3 天各 25 积分 = 75）
	endA := now.Add(-24 * time.Hour).UnixMilli()
	startA := endA - weekWindow.Milliseconds()
	h := loadWeeklyHistory()
	acc := h.Accounts["acc1"]
	acc.DailyCredits = map[string]float64{
		time.UnixMilli(startA).AddDate(0, 0, 1).Format("2006-01-02"): 25,
		time.UnixMilli(startA).AddDate(0, 0, 2).Format("2006-01-02"): 25,
		time.UnixMilli(startA).AddDate(0, 0, 3).Format("2006-01-02"): 25,
		// 周期 A 结束后的日子不属于它
		time.UnixMilli(endA).AddDate(0, 0, 1).Format("2006-01-02"): 999,
	}
	acc.DailyTokens = map[string]int64{}
	acc.StreakDays = 4
	acc.LongestStreakDays = 9
	saveWeeklyHistory(h)

	rep := BuildWeeklyReport("acc1")
	if len(rep.Cycles) != 2 {
		t.Fatalf("应返回 2 个周期，got %d", len(rep.Cycles))
	}
	if rep.StreakDays != 4 || rep.LongestStreakDays != 9 {
		t.Errorf("连续天数应透传 4/9，got %d/%d", rep.StreakDays, rep.LongestStreakDays)
	}
	// 最新在前：进行中的当前周期排第一（无官方积分覆盖该窗口？有——999 那条属于当前周期）
	if !rep.Cycles[0].Active {
		t.Errorf("第一条应为进行中的当前周期，got %+v", rep.Cycles[0])
	}
	c := rep.Cycles[1]
	if c.Active {
		t.Errorf("第二条应为已完成周期")
	}
	// 官方积分口径：3 天 × 25 = 75 / 100 = 75%（覆盖采样的 70%）
	if c.UsedCredits != 75 {
		t.Errorf("周期积分消耗应为 75，got %v", c.UsedCredits)
	}
	if c.LimitCredits != 100 {
		t.Errorf("周期额度上限应为 100，got %v", c.LimitCredits)
	}
	if c.FinalPct < 74.9 || c.FinalPct > 75.1 {
		t.Errorf("官方口径期末应为 75%%，got %v", c.FinalPct)
	}
	if BuildWeeklyReport("不存在").Cycles != nil {
		t.Errorf("无记录账号应返回空报告")
	}
}

func TestMergeDailyCredits(t *testing.T) {
	dst := map[string]float64{"2026-10-01": 10}
	out := mergeDailyCredits(dst, []CreditUsageDay{
		{Date: "2026-10-01", Credits: 20}, // 覆盖
		{Date: "2026-10-02", Credits: 5},  // 新增
	})
	if out["2026-10-01"] != 20 || out["2026-10-02"] != 5 || len(out) != 2 {
		t.Errorf("合并结果不符: %+v", out)
	}
}

func TestHistoricalFromOfficialCredits(t *testing.T) {
	useTempDataDir(t)
	// 锚定午夜，使周期边界落在 00:00（边界日权重为 0/1，断言值确定）
	yy, mm, dd := time.Now().Date()
	today0 := time.Date(yy, mm, dd, 0, 0, 0, 0, time.Local)
	end := today0.Add(3 * 24 * time.Hour).UnixMilli() // 当前周期 3 天后重置
	ov := weeklyOV(40, 40, 100, end)
	TrackWeekly("acc1", ov)
	// 注入官方按天积分：上一周期桶 [end-14d, end-7d) 内 7 个整天各 10 积分（=70/100=70%）
	h := loadWeeklyHistory()
	acc := h.Accounts["acc1"]
	acc.DailyCredits = map[string]float64{}
	bucketStart := time.UnixMilli(end - 14*dayMs)
	for i := 0; i < 7; i++ {
		d := bucketStart.AddDate(0, 0, i).Format("2006-01-02")
		acc.DailyCredits[d] = 10
	}
	saveWeeklyHistory(h)

	// 再次 TrackWeekly 触发统计（同日采样去重，不影响）
	ov2 := weeklyOV(40, 40, 100, end)
	TrackWeekly("acc1", ov2)
	if ov2.Weekly == nil || ov2.Weekly.Historical == nil {
		t.Fatalf("官方数据可用时应立即有历史统计，got %+v", ov2.Weekly)
	}
	hist := ov2.Weekly.Historical
	if hist.Cycles != 1 {
		t.Errorf("应重建出 1 个历史周期，got %d", hist.Cycles)
	}
	if hist.WeeklyPercent < 69.9 || hist.WeeklyPercent > 70.1 {
		t.Errorf("均每周应 ≈ 70（70 积分 / 100 限额），got %v", hist.WeeklyPercent)
	}

	// 报告同样包含重建周期
	rep := BuildWeeklyReport("acc1")
	if len(rep.Cycles) != 2 {
		t.Fatalf("报告应含当前 + 1 个重建周期，got %d", len(rep.Cycles))
	}
	if !rep.Cycles[0].Active {
		t.Errorf("最新在前第一条应为当前进行中周期")
	}
	if rep.Cycles[1].Active || rep.Cycles[1].UsedCredits < 69.9 || rep.Cycles[1].UsedCredits > 70.1 {
		t.Errorf("第二条应为重建周期 70 积分，got %+v", rep.Cycles[1])
	}
}

func TestWeekSynthSkipsTrackedAndPartial(t *testing.T) {
	useTempDataDir(t)
	end := ms(72 * time.Hour)
	// 官方数据只覆盖上一周期桶内 3 天（不足 6 天）→ 不重建
	daily := map[string]float64{}
	bucketStart := time.UnixMilli(end - 14*dayMs)
	for i := 1; i <= 3; i++ {
		daily[bucketStart.AddDate(0, 0, i).Format("2006-01-02")] = 10
	}
	if got := weekSynthFromDaily(daily, end, nil); len(got) != 0 {
		t.Errorf("覆盖不足的周期不应重建，got %d", len(got))
	}
	// 覆盖 7 天 → 重建 1 个
	for i := 4; i <= 7; i++ {
		daily[bucketStart.AddDate(0, 0, i).Format("2006-01-02")] = 10
	}
	got := weekSynthFromDaily(daily, end, nil)
	if len(got) != 1 {
		t.Fatalf("应重建 1 个周期，got %d", len(got))
	}
	// 与已跟踪周期 End 重叠（±6 天）→ 跳过
	tracked := []int64{got[0].End}
	if again := weekSynthFromDaily(daily, end, tracked); len(again) != 0 {
		t.Errorf("与跟踪周期重叠的应跳过，got %d", len(again))
	}
}

func TestMatchSavedAccountFallback(t *testing.T) {
	t.Setenv("ZCAS_DATA_DIR", t.TempDir())
	// 已保存账号：邮箱口径 ID，UserID=12345
	meta := &store.Meta{ID: "em-abc1234567", UserID: "12345", Email: "a@b.c", Label: "测试号"}
	if err := store.Save(meta, &store.Snapshot{Version: 2}); err != nil {
		t.Fatal(err)
	}
	// 弱指纹导致 EmailShortID 漂移成 uid 口径，但 UserID 一致 → 应匹配
	fp := &fingerprint.Fingerprint{UserID: "12345", EmailShortID: "99988877"}
	if got := MatchSavedAccount(fp); got != "em-abc1234567" {
		t.Errorf("UserID 回退应匹配，got %q", got)
	}
	// UserID 缺失，邮箱一致（大小写不敏感）→ 匹配
	fp2 := &fingerprint.Fingerprint{Email: "A@B.C", EmailShortID: "zzz"}
	if got := MatchSavedAccount(fp2); got != "em-abc1234567" {
		t.Errorf("邮箱回退应匹配，got %q", got)
	}
	// 都不一致 → 空
	fp3 := &fingerprint.Fingerprint{UserID: "xxx", EmailShortID: "yyy"}
	if got := MatchSavedAccount(fp3); got != "" {
		t.Errorf("无匹配应返回空，got %q", got)
	}
	// 精确匹配仍然优先
	fp4 := &fingerprint.Fingerprint{UserID: "other", EmailShortID: "em-abc1234567"}
	if got := MatchSavedAccount(fp4); got != "em-abc1234567" {
		t.Errorf("精确 ID 应优先，got %q", got)
	}
}

func TestBuildMonthlyStat(t *testing.T) {
	now := time.Now()
	month := now.Format("2006-01")
	lastMonth := now.AddDate(0, -1, 0).Format("2006-01")
	daily := map[string]float64{
		fmt.Sprintf("%s-01", month): 100,
		fmt.Sprintf("%s-02", month): 50,
		fmt.Sprintf("%s-05", lastMonth): 999, // 上月不计
	}
	m := buildMonthlyStat(daily, 700) // 周限额 700 → 折算月上限 = 700 × 当月天数/7
	if m == nil {
		t.Fatal("有本月数据应返回统计")
	}
	if m.Credits != 150 || m.Days != 2 {
		t.Errorf("累计 150 / 覆盖 2 天，got %v/%d", m.Credits, m.Days)
	}
	daysInMonth := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day()
	wantLimit := 700 * float64(daysInMonth) / 7
	if m.LimitCredits != wantLimit {
		t.Errorf("折算月上限应为 %v，got %v", wantLimit, m.LimitCredits)
	}
	wantPct := 150 / wantLimit * 100
	if m.Percent < wantPct-0.01 || m.Percent > wantPct+0.01 {
		t.Errorf("百分比应为 %v，got %v", wantPct, m.Percent)
	}
	wantProj := (150.0 / float64(now.Day())) * float64(daysInMonth) / wantLimit * 100
	if m.ProjectedPercent < wantProj-0.01 || m.ProjectedPercent > wantProj+0.01 {
		t.Errorf("预计全月应为 %v，got %v", wantProj, m.ProjectedPercent)
	}
	// 周限额未知 → 不折算
	if m2 := buildMonthlyStat(daily, 0); m2.Percent != 0 || m2.LimitCredits != 0 {
		t.Errorf("周限额 0 时不应折算，got %+v", m2)
	}
	if buildMonthlyStat(nil, 700) != nil {
		t.Error("无数据应返回 nil")
	}
	if buildMonthlyStat(map[string]float64{fmt.Sprintf("%s-01", lastMonth): 5}, 700) != nil {
		t.Error("只有上月数据应返回 nil")
	}
}

func TestProjectionFallsBackToHistoryWhenFresh(t *testing.T) {
	useTempDataDir(t)
	// 已完成周期（1 天前结束，期末 70%）→ 历史日均 10%/天
	TrackWeekly("acc1", weeklyOV(70, 70, 100, time.Now().Add(-24*time.Hour).UnixMilli()))
	// 当前周期刚过 0.5 天、已用 10%：当前节奏 20%/天 外推出 140% 属失真
	end := time.Now().Add(156 * time.Hour).UnixMilli() // 剩 6.5 天
	ov := weeklyOV(10, 10, 100, end)
	TrackWeekly("acc1", ov)
	c := ov.Weekly.Current
	if c == nil {
		t.Fatal("应有本次统计")
	}
	// 投影 = 已用 10 + 历史日均 10 × 剩 6.5 = 75（而非 10/0.5×7 = 140）
	if c.ProjectedPercent < 74.9 || c.ProjectedPercent > 75.1 {
		t.Errorf("刚重置时应按历史日均投影 75，got %v", c.ProjectedPercent)
	}
	// 本次日均仍如实显示（10/0.5 = 20）
	if c.DailyPercent < 19.9 || c.DailyPercent > 20.1 {
		t.Errorf("本次日均应 = 20，got %v", c.DailyPercent)
	}
	if ov.Weekly.Historical == nil || ov.Weekly.Historical.Cycles != 1 {
		t.Errorf("应有一个跟踪历史周期，got %+v", ov.Weekly.Historical)
	}
}

func TestToMs(t *testing.T) {
	sec := time.Now().Unix()
	if got := toMs(sec); got != sec*1000 {
		t.Errorf("秒级时间戳应转毫秒，got %v", got)
	}
	milli := time.Now().UnixMilli()
	if got := toMs(milli); got != milli {
		t.Errorf("毫秒级时间戳应原样返回，got %v", got)
	}
}
