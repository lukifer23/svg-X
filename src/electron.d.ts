export {};

interface DirectoryGrant {
  grantId: string;
  displayPath: string;
}

interface ResizeRequest {
  enabled: boolean;
  width: number;
  height: number;
  maintainAspectRatio: boolean;
}

declare global {
  interface Window {
    electronAPI?: {
      selectInputDirectory: () => Promise<DirectoryGrant | null>;
      selectOutputDirectory: () => Promise<DirectoryGrant | null>;
      listBatchInputs: (
        grantId: string,
      ) => Promise<Array<{ id: string; name: string }>>;
      readBatchInput: (request: {
        grantId: string;
        fileId: string;
        resize: ResizeRequest;
      }) => Promise<{ pixels: ArrayBuffer; width: number; height: number }>;
      writeBatchOutput: (request: {
        grantId: string;
        baseName: string;
        content: string;
      }) => Promise<{ success: true; name: string }>;
      saveExport: (request: {
        defaultName: string;
        format: "svg" | "eps" | "dxf" | "json";
        content: string;
      }) => Promise<{ success: true } | null>;
      openGrantedDirectory: (grantId: string) => Promise<void>;
      getAppVersion?: () => Promise<string>;
      toggleConsole?: () => Promise<{ visible: boolean }>;
    };
  }
}
