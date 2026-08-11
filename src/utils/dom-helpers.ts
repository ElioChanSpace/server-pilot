export const isTextInputElement = (
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

export const isEditableElement = (element: Element | null) =>
  isTextInputElement(element) || (element instanceof HTMLElement && element.isContentEditable);

export const isInsideTerminal = (element: Element | null) =>
  element instanceof Element && Boolean(element.closest(".xterm, .xterm-host"));

export const getCopyTextFromTarget = (target: Element | null) => {
  if (isTextInputElement(target)) {
    const { selectionStart, selectionEnd, value } = target;
    if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) {
      return value.slice(selectionStart, selectionEnd);
    }
  }

  return window.getSelection()?.toString() ?? "";
};

export const insertTextIntoEditable = (target: Element | null, text: string) => {
  if (!text) {
    return false;
  }

  if (isTextInputElement(target)) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    target.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
};
