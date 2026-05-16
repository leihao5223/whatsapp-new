export type GmailAccountRow = {
  id: string;
  email: string;
  password?: string;
  note?: string;
  lastStatus?: string;
  lastMessage?: string;
  lastRunAt?: string;
};

export type GmailSettings = {
  defaultDisplayName: string;
  delayBetweenSec: number;
  updateAvatar: boolean;
  headless: boolean;
};

export type GmailAccountsPayload = {
  accounts: GmailAccountRow[];
  settings: GmailSettings;
  updatedAt?: string;
  hasAvatar?: boolean;
};

export type GmailBatchTask = {
  id: string;
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
