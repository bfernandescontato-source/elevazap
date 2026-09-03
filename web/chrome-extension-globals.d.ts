// The downloadable extension source lives under public/ so it can be served as
// an asset. Next also type-checks TypeScript files in that directory, while the
// extension's own @types/chrome dependency is intentionally nested with it.
type ChromeMessageListener = (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void;

declare const chrome: {
  runtime: {
    sendMessage(message: any, callback?: (response: any) => void): Promise<any> | void;
    onMessage: { addListener(listener: ChromeMessageListener): void };
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: () => void): void };
  };
  storage: { local: { get(key: string): Promise<Record<string, any>>; set(value: Record<string, any>): Promise<void> } };
  alarms: {
    get(name: string): Promise<{ name: string } | undefined>;
    create(name: string, info: { periodInMinutes: number }): void;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  tabs: {
    create(options: { url: string; active?: boolean }): Promise<{ id: number }>;
    get(id: number): Promise<{ status?: string }>;
    sendMessage(id: number, message: any): Promise<any>;
    remove(id: number): Promise<void>;
  };
};
