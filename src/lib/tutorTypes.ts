import type { PageCitation } from "@/services/apiTypes";

export type DefaultCitation = PageCitation;

export interface TutorTurnView {
  role: "user" | "assistant";
  content: string;
  citations: PageCitation[];
  notFound?: boolean;
  supported?: boolean;
}
