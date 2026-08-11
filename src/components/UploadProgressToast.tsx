import React from "react";
import type { UploadProgressOverlayState } from "../types/app";
import { formatBytes, formatTransferRate, formatEta } from "../utils/format-helpers";

export const UploadProgressToast: React.FC<{
  overlay: UploadProgressOverlayState;
}> = ({ overlay }) => {
  return (
    <div className="upload-progress-toast" data-status={overlay.status}>
      <div className="upload-progress-toast__header">
        <strong>
          上传文件
          {overlay.totalFiles > 1
            ? ` ${overlay.currentFileIndex}/${overlay.totalFiles}`
            : ""}
        </strong>
        <span>{overlay.serverName}</span>
      </div>
      <div className="upload-progress-toast__name">{overlay.currentFileName}</div>
      <div className="upload-progress-toast__path">{overlay.currentDirectory}</div>
      <div className="upload-progress-toast__bar">
        <div
          className="upload-progress-toast__bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, overlay.progressPercent))}%` }}
        />
      </div>
      <div className="upload-progress-toast__meta">
        <span>{overlay.progressPercent}%</span>
        <span>{formatTransferRate(overlay.bytesPerSecond) ?? "--"}</span>
        <span>{formatEta(overlay.etaSeconds) ?? "--:--"}</span>
      </div>
      <div className="upload-progress-toast__footer">
        <span>
          {formatBytes(overlay.transferredBytes) ?? "0 B"}
          {" / "}
          {formatBytes(overlay.totalBytes) ?? "--"}
        </span>
        <span>{overlay.message ?? ""}</span>
      </div>
    </div>
  );
};
