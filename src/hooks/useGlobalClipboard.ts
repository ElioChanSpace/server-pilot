import { useEffect } from "react";
import { isInsideTerminal, isEditableElement, getCopyTextFromTarget, insertTextIntoEditable } from "../utils/dom-helpers";

export function useGlobalClipboard() {
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    const handleGlobalClipboardShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (isInsideTerminal(target)) {
        return;
      }

      const hasPrimaryModifier = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!hasPrimaryModifier || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "c") {
        const text = getCopyTextFromTarget(target);
        if (!text) {
          return;
        }

        event.preventDefault();
        void navigator.clipboard.writeText(text).catch(error => {
          console.error("快捷键复制失败:", error);
        });
        return;
      }

      if (key === "v" && isEditableElement(target)) {
        event.preventDefault();
        void navigator.clipboard.readText()
          .then(text => {
            insertTextIntoEditable(target, text);
          })
          .catch(error => {
            console.error("快捷键粘贴失败:", error);
          });
      }
    };

    window.addEventListener("keydown", handleGlobalClipboardShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalClipboardShortcut, true);
    };
  }, []);
}
