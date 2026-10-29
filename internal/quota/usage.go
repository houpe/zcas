package quota

// 官方按天用量接口（bigmodel.cn / chat.z.ai 同路径，鉴权与 quota/limit 一致：
// Authorization 裸 oauth access_token）。逆向自 coding-plan/personal/usage 页面。
//
// 用途：本地采样只在「打开工具查额度」时记一条，隔几天不看就漏；
// 官方 credit-usage/activity 有完整的按天积分序列，周周期用量改为
// 「周期内各天积分之和」，准确度不再依赖工具打开频率。

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// creditUsagePath 官方按天用量端点。
const creditUsagePath = "/api/monitor/credit-usage/activity"

// 官方数据回看窗口：13 个周期 + 余量（请求一次拉全，之后按天合并）。
const creditSyncWindowDays = 120

// creditSyncMinInterval 官方数据同步限频（每次查额度都会触发，避免打接口）。
const creditSyncMinInterval = time.Hour

// historyMu 串行化历史文件写入（TrackWeekly / SyncDailyCredits / ForgetWeekly
// 可能被多账号并发触发，读走原子 rename 无需加锁）。
var historyMu sync.Mutex

// CreditUsageActivity credit-usage/activity 响应的有效部分。
type CreditUsageActivity struct {
	Summary struct {
		TotalTokens         int64  `json:"totalTokens"`
		PeakDailyTokens     int64  `json:"peakDailyTokens"`
		PeakDailyTokensDate string `json:"peakDailyTokensDate"`
		CurrentStreakDays   int    `json:"currentStreakDays"`
		LongestStreakDays   int    `json:"longestStreakDays"`
	} `json:"summary"`
	Series []CreditUsageDay `json:"series"`
}

// CreditUsageDay 一天的用量。
type CreditUsageDay struct {
	Date        string  `json:"date"`        // 2026-10-28
	Credits     float64 `json:"credits"`     // 当天积分消耗
	Tokens      int64   `json:"tokens"`      // 当天 tokens
	McpCalls    int     `json:"mcpCalls"`    // MCP 调用次数
}

// FetchCreditUsageActivity 查询官方按天用量（type=1 天粒度）。
// 鉴权与官方客户端一致：Authorization 头裸 token（与 FetchCodingPlanUsage 相同）。
func FetchCreditUsageActivity(provider, token string, start, end time.Time) (*CreditUsageActivity, error) {
	if token == "" {
		return nil, fmt.Errorf("缺少 credit-usage token")
	}
	q := url.Values{}
	q.Set("startTime", start.Format("2006-01-02 15:04:05"))
	q.Set("endTime", end.Format("2006-01-02 15:04:05"))
	q.Set("type", "1")
	req, err := http.NewRequest(http.MethodGet, codingPlanHost(provider)+creditUsagePath+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", token)
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("credit-usage 接口 HTTP %d", resp.StatusCode)
	}
	var env struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Summary struct {
				TotalTokens         int64  `json:"totalTokens"`
				PeakDailyTokens     int64  `json:"peakDailyTokens"`
				PeakDailyTokensDate string `json:"peakDailyTokensDate"`
				CurrentStreakDays   int    `json:"currentStreakDays"`
				LongestStreakDays   int    `json:"longestStreakDays"`
			} `json:"summary"`
			Series []struct {
				Date         string `json:"date"`
				TotalCredits string `json:"totalCredits"`
				TotalTokens  int64  `json:"totalTokens"`
				McpCalls     int    `json:"mcpCalls"`
			} `json:"series"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil || env.Code != 200 {
		return nil, fmt.Errorf("credit-usage 接口返回异常: %s", truncate(string(body), 120))
	}
	out := &CreditUsageActivity{Summary: env.Data.Summary}
	for _, s := range env.Data.Series {
		credits, _ := toNumber(s.TotalCredits)
		out.Series = append(out.Series, CreditUsageDay{
			Date: s.Date, Credits: credits, Tokens: s.TotalTokens, McpCalls: s.McpCalls,
		})
	}
	return out, nil
}

// SyncDailyCredits 拉取官方按天积分并合并进账号历史（best-effort，静默失败）。
// 限频 creditSyncMinInterval；凭据里按 EnrichCodingPlan 同序取可用 token。
// 调用方可在 goroutine 里执行（historyMu 保证文件写安全）。
func SyncDailyCredits(accountKey string, cred map[string]any, secret string) {
	if accountKey == "" || len(cred) == 0 {
		return
	}

	historyMu.Lock()
	defer historyMu.Unlock()

	h := loadWeeklyHistory()
	acc := h.Accounts[accountKey]
	if acc == nil {
		acc = &weeklyAccountHistory{}
		h.Accounts[accountKey] = acc
	}
	if time.Since(time.UnixMilli(acc.CreditsSyncAt)) < creditSyncMinInterval {
		return
	}

	act := fetchActivityWithCred(cred, secret)
	if act == nil {
		return
	}
	acc.DailyCredits = mergeDailyCredits(acc.DailyCredits, act.Series)
	acc.DailyTokens = mergeDailyTokens(acc.DailyTokens, act.Series)
	acc.StreakDays = act.Summary.CurrentStreakDays
	acc.LongestStreakDays = act.Summary.LongestStreakDays
	acc.CreditsSyncAt = time.Now().UnixMilli()
	pruneDailyCredits(acc, creditSyncWindowDays+30)
	saveWeeklyHistory(h)
}

// fetchActivityWithCred 按凭据候选顺序请求官方按天用量，首个成功即返回。
func fetchActivityWithCred(cred map[string]any, secret string) *CreditUsageActivity {
	decrypt := func(k string) string {
		s, _ := cred[k].(string)
		return safeDecrypt(s, secret)
	}
	now := time.Now()
	start := now.AddDate(0, 0, -creditSyncWindowDays)
	// 1) 客户端物化的 coding-plan api-key（与 EnrichCodingPlan 同序，确定性遍历）
	keys := make([]string, 0, len(cred))
	for k := range cred {
		if strings.HasPrefix(k, "account-provider:coding-plan:") && strings.HasSuffix(k, ":api-key") {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	try := func(provider, token string) *CreditUsageActivity {
		if token == "" {
			return nil
		}
		if act, err := FetchCreditUsageActivity(provider, token, start, now); err == nil {
			return act
		}
		return nil
	}
	for _, k := range keys {
		provider := "bigmodel"
		if strings.Contains(k, ":zai-") {
			provider = "zai"
		}
		if act := try(provider, safeDecrypt(cred[k].(string), secret)); act != nil {
			return act
		}
	}
	// 2) oauth access_token 兜底
	for _, p := range []string{"bigmodel", "zai"} {
		if act := try(p, decrypt("oauth:"+p+":access_token")); act != nil {
			return act
		}
	}
	return nil
}

func mergeDailyCredits(dst map[string]float64, series []CreditUsageDay) map[string]float64 {
	if dst == nil {
		dst = map[string]float64{}
	}
	for _, d := range series {
		dst[d.Date] = d.Credits
	}
	return dst
}

func mergeDailyTokens(dst map[string]int64, series []CreditUsageDay) map[string]int64 {
	if dst == nil {
		dst = map[string]int64{}
	}
	for _, d := range series {
		dst[d.Date] = d.Tokens
	}
	return dst
}

// pruneDailyCredits 控制按天数据规模：只保留最近 keepDays 天。
func pruneDailyCredits(acc *weeklyAccountHistory, keepDays int) {
	cutoff := time.Now().AddDate(0, 0, -keepDays).Format("2006-01-02")
	for d := range acc.DailyCredits {
		if d < cutoff {
			delete(acc.DailyCredits, d)
		}
	}
	for d := range acc.DailyTokens {
		if d < cutoff {
			delete(acc.DailyTokens, d)
		}
	}
}
