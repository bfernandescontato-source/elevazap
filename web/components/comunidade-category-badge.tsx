import { CATEGORY_LABELS, CATEGORY_STYLES } from "@/modules/comunidade/constants";
import type { CommunityCategory } from "@/modules/comunidade/types";

export function ComunidadeCategoryBadge({ category }: { category: CommunityCategory }) {
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${CATEGORY_STYLES[category]}`}>{CATEGORY_LABELS[category]}</span>;
}
