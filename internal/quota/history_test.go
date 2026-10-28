package quota

// 周额度历史采样与日均消耗统计的单元测试。
// TrackWeekly 内部取 time.Now()，测试里用相对 now 的重置时间构造各场景。

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"zcas/internal/paths"
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
