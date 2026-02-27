// Shared type declaration for the Electron contextBridge API
// exposed via preload.js. All components import from here.

export {};

declare global {
  interface Window {
    electronAPI?: {
      // Directory selection
      selectInputDirectory: () => Promise<string | null>;
      selectOutputDirectory: () => Promise<string | null>;

      // File system operations
      readDirectory: (dirPath: string) => Promise<string[] | { error: string }>;
      saveSvg: (data: { svgData: string; outputPath: string }) => Promise<{ success: boolean; path: string } | { error: string }>;
      readImageFile: (filePath: string) => Promise<string | { error: string }>;

      // Image processing (optional — not available in all builds)
      resizeImage?: (data: {
        imageData: string;
        width: number;
        height: number;
        maintainAspectRatio?: boolean;
      }) => Promise<string | { error: string }>;

      // Native save dialog — format controls file filter and default extension
      showSaveDialog?: (options: { defaultName?: string; format?: 'svg' | 'eps' | 'dxf' | 'json' }) => Promise<string | null>;

      // Shell utilities
      openOutputDirectory?: (dirPath: string) => Promise<void>;

      // Path utilities — joins path segments using OS-native separators
      joinPaths?: (...segments: string[]) => Promise<string>;

      // App info
      getAppVersion?: () => Promise<string>;

      // Debug console toggle
      toggleConsole?: () => Promise<{ visible: boolean }>;
    };
  }
}
