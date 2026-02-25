declare module 'screenshot-desktop' {
  interface Display {
    id: number;
    name?: string;
  }

  interface ScreenshotOptions {
    format?: 'png' | 'jpg';
    screen?: number;
    filename?: string;
  }

  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  namespace screenshot {
    function listDisplays(): Promise<Display[]>;
  }

  export = screenshot;
}
