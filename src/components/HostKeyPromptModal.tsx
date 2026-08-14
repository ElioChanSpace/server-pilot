import React from "react";
import { invoke } from "@tauri-apps/api/core";
import modalStyles from "./Modal.module.css";
import type { HostKeyPromptEvent } from "../types/app";
import type { Server } from "../context/ServerContext";

export const HostKeyPromptModal: React.FC<{
  prompt: HostKeyPromptEvent;
  servers: Server[];
  onClose: () => void;
}> = ({ prompt, servers, onClose }) => {
  const handleRespond = (accept: boolean) => {
    onClose();
    void invoke("respond_to_host_key_prompt", { sessionId: prompt.sessionId, accept }).catch(error => {
      console.error("回应主机指纹失败:", error);
    });
  };

  return (
    <div className={modalStyles.overlay}>
      <div className={modalStyles.content}>
        <h2 className={modalStyles.title}>主机指纹确认</h2>
        <p className={modalStyles.helpText}>
          首次连接{" "}
          <strong>
            {servers.find(server => server.id === prompt.serverId)?.name ?? "服务器"}
          </strong>
          ，请核对远程主机指纹：
        </p>
        <pre className={modalStyles.fingerprint}>{prompt.fingerprint}</pre>
        <p className={modalStyles.helpText}>
          确认后将写入 known_hosts。若指纹与预期不符，请选择"取消"。
        </p>
        <div className={modalStyles.actions}>
          <button type="button" className={modalStyles.secondaryButton} onClick={() => handleRespond(false)}>
            取消
          </button>
          <button type="button" className="primary-btn" onClick={() => handleRespond(true)}>
            信任并连接
          </button>
        </div>
      </div>
    </div>
  );
};
