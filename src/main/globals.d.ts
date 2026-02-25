// Type declarations for Electron Forge injected globals
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// electron-squirrel-startup type
declare module 'electron-squirrel-startup' {
  const squirrelStartup: boolean;
  export = squirrelStartup;
}
