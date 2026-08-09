export interface AppSettings {
  terminalIdleDisconnectEnabled: boolean;
  terminalIdleDisconnectMinutes: number;
  terminalFontSize: number;
  terminalScrollback: number;
  minimizeToTrayOnClose: boolean;
  themePreference: 'system' | 'light' | 'dark';
  notificationsEnabled: boolean;
  confirmOnDisconnect: boolean;
}
