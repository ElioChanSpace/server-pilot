import { FaPlug, FaQuestionCircle, FaSpinner, FaUnlink } from 'react-icons/fa';
import type { IconType } from 'react-icons';

export const formatServerStatus = (status: string) => {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'disconnected':
      return '未连接';
    default:
      return status;
  }
};

export const getServerStatusMeta = (status: string): {
  color: string;
  icon: IconType;
  spinning: boolean;
} => {
  switch (status) {
    case 'connected':
      return {
        color: '#4caf50',
        icon: FaPlug,
        spinning: false,
      };
    case 'connecting':
      return {
        color: '#ff9800',
        icon: FaSpinner,
        spinning: true,
      };
    case 'disconnected':
      return {
        color: '#f44336',
        icon: FaUnlink,
        spinning: false,
      };
    default:
      return {
        color: 'var(--text-secondary)',
        icon: FaQuestionCircle,
        spinning: false,
      };
  }
};
