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

export type LandingUserTemplateSource = 'zip' | 'url';

export type LandingUserTemplate = {
  id: string;
  name: string;
  source: LandingUserTemplateSource;
  /** ZIP 包内入口 HTML 相对路径（POSIX） */
  entry: string;
  /** source === 'url' 时的完整地址 */
  remoteUrl?: string;
  /** 是否已生成 cover.png（首次预览后由服务端截取） */
  coverCaptured: boolean;
};

export type LandingDoc = {
  version: number;
  userId: string;
  updatedAt: string;
  profile: LandingProfile;
  settings: LandingSettings;
  runtime: LandingRuntime;
  customTemplates: LandingUserTemplate[];
};
