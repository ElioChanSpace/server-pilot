export interface AppSettings {
  terminalIdleDisconnectEnabled: boolean;
  terminalIdleDisconnectMinutes: number;
  terminalFontSize: number;
  terminalScrollback: number;
  minimizeToTrayOnClose: boolean;
  themePreference: string;
  notificationsEnabled: boolean;
  confirmOnDisconnect: boolean;
  terminalTheme?: string;
}
