export type CommunityCategory = "resultado" | "oferta" | "trafego" | "automacao" | "duvida" | "estrategia" | "aviso" | "geral";

export type CommunityAuthor = {
  user_id: string | null;
  name: string | null;
  email: string | null;
};

export type CommunityPost = {
  id: string;
  account_id: string;
  user_id: string | null;
  content: string;
  category: CommunityCategory;
  is_official: boolean;
  is_pinned: boolean;
  is_hidden: boolean;
  image_paths: string[];
  image_urls: string[];
  result_amount_cents: number | null;
  result_marketplace: string | null;
  created_at: string;
  updated_at: string;
  author: CommunityAuthor;
  likes_count: number;
  comments_count: number;
  viewer_has_liked: boolean;
};

export type CommunityComment = {
  id: string;
  post_id: string;
  user_id: string | null;
  content: string;
  created_at: string;
  author: CommunityAuthor;
};

export type CommunityNotification = {
  id: string;
  type: "like" | "comment";
  post_id: string | null;
  actor_user_id: string | null;
  actor: CommunityAuthor;
  read_at: string | null;
  created_at: string;
};
