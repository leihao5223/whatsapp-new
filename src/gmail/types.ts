export type GmailLoginStatus = 'logged_out' | 'logged_in' | 'logging_in' | 'failed';

export type GmailAccountRow = {
  id: string;
  email: string;
  password?: string;
  note?: string;
  lastStatus?: string;
  lastMessage?: string;
  lastRunAt?: string;
  loginStatus?: GmailLoginStatus | string;
  loginMessage?: string;
  loggedInAt?: string;
  sessionActive?: boolean;
};

export type GmailSettings = {
  defaultDisplayName: string;
  delayBetweenSec: number;
  updateAvatar: boolean;
  headless: boolean;
  autoLoginOnSave?: boolean;
};

export type GmailInboxMessage = {
  sender: string;
  subject: string;
  snippet: string;
  time: string;
  unread: boolean;
};

export type GmailInboxPayload = {
  fetchedAt: string;
  count: number;
  messages: GmailInboxMessage[];
};

export type GmailAccountsPayload = {
  accounts: GmailAccountRow[];
  settings: GmailSettings;
  updatedAt?: string;
  hasAvatar?: boolean;
  liveSessions?: string[];
};

export type GmailBatchTask = {
  id: string;
  kind?: string;
  status: string;
  total: number;
  processed: number;
  success: number;
  failed: number;
  createdAt: string;
  finishedAt?: string;
  currentEmail?: string;
  logs: string[];
  records: Array<{ email: string; ok: boolean; message: string }>;
  error?: string;
  newDisplayName?: string;
};
