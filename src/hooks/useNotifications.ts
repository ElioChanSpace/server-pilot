import { useRef, useEffect, useCallback } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export function useNotifications() {
  const notificationPermissionRef = useRef(false);
  const notificationsEnabledRef = useRef(true);

  useEffect(() => {
    void (async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        notificationPermissionRef.current = granted;
      } catch (error) {
        console.error("初始化通知权限失败:", error);
      }
    })();
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    if (!notificationPermissionRef.current || !notificationsEnabledRef.current) {
      return;
    }
    try {
      sendNotification({ title, body });
    } catch (error) {
      console.error("发送通知失败:", error);
    }
  }, []);

  return { notify, notificationsEnabledRef };
}
