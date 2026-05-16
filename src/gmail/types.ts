export type GmailLoginStatus =
  | 'logged_out'
  | 'logged_in'
  | 'logging_in'
  | 'needs_code'
  | 'needs_approve'
  | 'failed';

export type GmailAccountRow = {
  id: string;
  email: string;
  password?: string;
  note?: string;
  loginStatus?: GmailLoginStatus | string;
  loginMessage?: string;
  loggedInAt?: string;
  sessionActive?: boolean;
  hasNewMail?: boolean;
  inboxFingerprint?: string;
  inboxUnreadCount?: number;
};

export type GmailSettings = {
  defaultDisplayName: string;
  delayBetweenSec: number;
  updateAvatar: boolean;
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

export type GmailLoginResult = {
  success: boolean;
  status: string;
  hint: string;
  sessionActive?: boolean;
  account?: GmailAccountRow;
  error?: string;
};
