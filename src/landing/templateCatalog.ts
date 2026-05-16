export type GalleryItem = {
  id: string;
  name: string;
  accent: string;
  thumb: string;
};

export const LANDING_STYLE_IDS = ['premium-scroll', 'hero-split', 'card-stack', 'minimal-center'] as const;

export const LANDING_GALLERY: GalleryItem[] = [
  { id: 'gallery-aurora', name: '极光', accent: '#22d3ee', thumb: 'linear-gradient(135deg,#042c31,#22d3ee)' },
  { id: 'gallery-moss', name: '苔绿', accent: '#34d399', thumb: 'linear-gradient(135deg,#052e1f,#34d399)' },
  { id: 'gallery-sunset', name: '暮紫', accent: '#a78bfa', thumb: 'linear-gradient(135deg,#1e1033,#a78bfa)' },
  { id: 'gallery-ember', name: '琥珀', accent: '#fb923c', thumb: 'linear-gradient(135deg,#2a1208,#fb923c)' },
  { id: 'gallery-ice', name: '冰川', accent: '#38bdf8', thumb: 'linear-gradient(135deg,#0b1a2a,#38bdf8)' },
  { id: 'gallery-ruby', name: '酒红', accent: '#fb7185', thumb: 'linear-gradient(135deg,#2a0a14,#fb7185)' },
];
