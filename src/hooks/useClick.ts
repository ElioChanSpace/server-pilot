import { useRef } from 'react';

const CLICK_DELAY = 250; // ms

type ClickHandler = (event: React.MouseEvent) => void;

export function useClick(onClick: ClickHandler, onDoubleClick: ClickHandler) {
  const clickTimeout = useRef<number | null>(null);

  const handler = (event: React.MouseEvent) => {
    // --- FIX: Stop the event from bubbling up to parent elements ---
    event.stopPropagation();

    if (clickTimeout.current) {
      // This is a double-click
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
      onDoubleClick(event);
    } else {
      // This is a single-click (or the first click of a double-click)
      clickTimeout.current = window.setTimeout(() => {
        onClick(event);
        clickTimeout.current = null;
      }, CLICK_DELAY);
    }
  };

  return handler;
}