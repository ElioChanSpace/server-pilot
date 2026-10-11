import { useEffect, useRef } from "react";
import { useAppVisibility } from "./useAppVisibility";

/**
 * 安静轮询：窗口可见时按 intervalMs 采样；隐藏/最小化时暂停；
 * 重新可见时立即补一次采样（docs/design/principles.md §7）。
 *
 * 首次挂载不立即采样（由调用方的初始加载负责，避免重复请求）；
 * 之后每次激活（恢复可见、重新启用）都会立即补一次。
 *
 * @param callback 采样函数（应自带错误处理）
 * @param intervalMs 间隔（毫秒）
 * @param enabled 额外开关（如自动刷新开关、连接状态）
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true
): void {
  const visible = useAppVisibility();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const firstActivationRef = useRef(true);

  useEffect(() => {
    if (!enabled || !visible) {
      return;
    }
    let disposed = false;
    const run = () => {
      if (disposed) return;
      void Promise.resolve(callbackRef.current()).catch(() => {});
    };

    if (firstActivationRef.current) {
      firstActivationRef.current = false;
    } else {
      run();
    }

    const timer = window.setInterval(run, intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, visible, intervalMs]);
}
