import type { ExportFormat } from "./core/vectorDocument";

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
      beginBatch: (request: {
        inputGrantId: string;
        outputGrantId: string;
        format: ExportFormat;
      }) => Promise<string>;
      cancelBatch: (id: string) => Promise<void>;
      finishBatch: (id: string) => Promise<void>;
      readBatchInput: (request: {
        runId: string;
        fileId: string;
        resize: ResizeRequest;
        highestQuality: boolean;
      }) => Promise<{ pixels: ArrayBuffer; width: number; height: number }>;
      writeBatchOutput: (request: {
        runId: string;
        baseName: string;
        content: string;
      }) => Promise<{ success: true; name: string }>;
      saveBatchFailureReport: (request: {
        outputGrantId: string;
        content: string;
      }) => Promise<{ success: true; name: string }>;
      saveExport: (request: {
        defaultName: string;
        format: ExportFormat;
        content: string;
      }) => Promise<{ success: true } | null>;
      openGrantedDirectory: (grantId: string) => Promise<void>;
      getAppVersion?: () => Promise<string>;
      toggleConsole?: () => Promise<{ visible: boolean }>;
    };
  }
}
