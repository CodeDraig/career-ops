import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" aria-label="Loading automation inbox">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  );
}
