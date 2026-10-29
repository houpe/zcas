//go:build darwin

// Package platform 封装所有 macOS 平台相关操作（进程管理、协议回调外的系统交互）。
package platform

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// ZCode macOS 客户端实测值。
const (
	BundleID    = "dev.zcode.app"
	ProcessName = "ZCode"
)

var ErrZCodeNotRunning = errors.New("ZCode 未在运行")

// zcodePIDs 返回 ZCode 主进程的 PID 列表。
//
// 不用 pgrep/pkill：实测 ZCode 3.16+ 的主进程对 libproc 枚举不可见
// （pgrep -x ZCode 匹配不到，而 ps 走 kinfo 能看到 comm=ZCode），
// 改为解析 `ps -axo pid=,comm=`，按可执行文件名（路径最后一段）精确匹配；
// Helper 进程（"ZCode Helper"、"ZCode Helper (Renderer)" 等）名字不同，天然排除，
// zcode-cli / zcode-host 等辅助二进制大小写不同也不会误匹配。
func zcodePIDs() []int {
	out, err := exec.Command("ps", "-axo", "pid=,comm=").Output()
	if err != nil {
		return nil
	}
	var pids []int
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil || pid == os.Getpid() {
			continue
		}
		// comm 含空格的进程名（如 Helper (Renderer)），把余下字段拼回完整名
		name := strings.Join(fields[1:], " ")
		if filepath.Base(name) == ProcessName {
			pids = append(pids, pid)
		}
	}
	return pids
}

// IsZCodeRunning 检测 ZCode 主进程是否在运行。
func IsZCodeRunning() bool {
	return len(zcodePIDs()) > 0
}

// KillZCode 先 SIGTERM 优雅退出，超时后 SIGKILL 升级，再等确认。
func KillZCode(wait time.Duration) error {
	pids := zcodePIDs()
	if len(pids) == 0 {
		return nil
	}
	for _, pid := range pids {
		_ = syscall.Kill(pid, syscall.SIGTERM)
	}
	if waitGone(wait) {
		return nil
	}
	if pids = zcodePIDs(); len(pids) > 0 {
		for _, pid := range pids {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}
	if waitGone(3 * time.Second) {
		return nil
	}
	return errors.New("关闭 ZCode 超时，请手动退出 ZCode 后重试")
}

func waitGone(d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if !IsZCodeRunning() {
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return !IsZCodeRunning()
}

// LaunchZCode 用 bundle id 启动（比 -a 应用名稳定，不受改名/多副本影响）。
func LaunchZCode() error {
	if err := exec.Command("open", "-g", "-b", BundleID).Run(); err != nil {
		if err2 := exec.Command("open", "-g", "-a", ProcessName).Run(); err2 != nil {
			return fmt.Errorf("启动 ZCode 失败: %v / %v", err, err2)
		}
	}
	return nil
}

// OpenURL 用系统默认浏览器打开 URL。
func OpenURL(url string) error {
	return exec.Command("open", url).Run()
}

var cachedZCodeVersion string

// ZCodeVersion 读取已安装 ZCode 客户端的版本（billing 等接口的 app_version 参数应与真实客户端一致）。
func ZCodeVersion() string {
	if cachedZCodeVersion != "" {
		return cachedZCodeVersion
	}
	out, err := exec.Command("defaults", "read", "/Applications/ZCode.app/Contents/Info.plist", "CFBundleShortVersionString").Output()
	if err == nil {
		cachedZCodeVersion = strings.TrimSpace(string(out))
	}
	return cachedZCodeVersion
}

var cachedOSVersion string

// OSVersion 返回 macOS 版本号（X-Os-Version 头用）。
func OSVersion() string {
	if cachedOSVersion != "" {
		return cachedOSVersion
	}
	out, err := exec.Command("sw_vers", "-productVersion").Output()
	if err == nil {
		cachedOSVersion = strings.TrimSpace(string(out))
	}
	return cachedOSVersion
}
