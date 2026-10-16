import { IndeedSearch } from "@/components/explore/indeed-search";
import { readInbox, readApplications } from "@/lib/career-ops";

export const dynamic = "force-dynamic";

export default function IndeedPage() {
  const knownUrls = [...readInbox().map(job => job.url), ...readApplications().map(job => job.applyLink.match(/https?:\/\/[^\s)<>]+/)?.[0] || "")];
  return <IndeedSearch knownUrls={knownUrls} />;
}
