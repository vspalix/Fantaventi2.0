export type AnnouncementKind = "text" | "image" | "both";

export type Announcement = {
  id: string;
  kind: AnnouncementKind;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isActive: boolean;
  oncePerUser: boolean;
};
