export { Connection, ThreadInstance, Notification, ThreadifySpanExporter } from './index.js';
import type { Connection, ThreadInstance, StepContext } from './index.js';

export interface BrowserGrant {
  token: string;
  expires_at: string;
}

export interface BrowserConnectOptions {
  engineUrl?: string;
  wsUrl?: string;
  /** Same-origin application proxy for archived GraphQL reads. */
  graphqlUrl?: string;
  serviceName?: string;
  debug?: boolean;
  getAccessToken(): Promise<BrowserGrant> | BrowserGrant;
}

export class ThreadifyBrowser {
  static connect(options: BrowserConnectOptions): Promise<Connection>;
  static autoCapture(options: BrowserAutoCaptureOptions): BrowserAutoCapture;
}

export interface BrowserAutoCaptureOptions {
  thread: ThreadInstance;
  root?: Document | Element;
  events?: Array<'click' | 'submit' | 'change'>;
  /** Explicitly mapped actions complete a step; other actions remain evidence. */
  steps?: Record<string, string>;
  onError?: (error: Error) => void;
  onRecorded?: (action: { name: string; step: string | null; context: StepContext; eventType: string; path: string; result: unknown }) => void;
}

export class BrowserAutoCapture {
  constructor(options: BrowserAutoCaptureOptions);
  scope(root: Element, options?: { include?: string[]; thread?: ThreadInstance; steps?: Record<string, string> }): () => void;
  capture(name: string, context?: StepContext, options?: { eventType?: string; path?: string; eventId?: string }): Promise<{ classification: 'free_form' | 'step_candidate' | 'substep' | 'mapped_step' | 'mapping_rejected'; mappedStep?: string; stepId?: string; message?: string }>;
  stop(): void;
}

export default ThreadifyBrowser;
