export const formatBytes = (value: number | null) => {
  if (!value || value <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
};

export const formatTransferRate = (bytesPerSecond: number | null) => {
  const formatted = formatBytes(bytesPerSecond);
  return formatted ? `${formatted}/s` : null;
};

export const formatEta = (etaSeconds: number | null) => {
  if (etaSeconds === null || etaSeconds < 0) {
    return null;
  }

  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "上传失败，请稍后重试。";
};
