export type LandingButtonType = 'app' | 'service' | 'site';

export type LandingStyleId = 'hero-split' | 'card-stack' | 'minimal-center';

export type LandingProfile = {
  projectName: string;
  companyType: string;
  buttonType: LandingButtonType;
  appDownloadUrl: string;
  serviceUrl: string;
  siteUrl: string;
  hasLogo: boolean;
};

export type LandingSettings = {
  pdfPresentation: boolean;
  randomStyle: boolean;
  lockTemplateId: string;
  usePlaceholderImages: boolean;
  domainsText: string;
  styleSendLimits: Record<string, number>;
};

export type LandingHistoryFrame = {
  styleId: string;
  seed: number;
};

export type LandingRuntime = {
  currentTemplateId: string;
  historyStack: LandingHistoryFrame[];
  historyIndex: number;
  styleSendUsed: Record<string, number>;
};

export type LandingDoc = {
  version: number;
  userId: string;
  updatedAt: string;
  profile: LandingProfile;
  settings: LandingSettings;
  runtime: LandingRuntime;
};
