export default function Loading() {
  return (
    <div className="flex h-full min-h-40 items-center justify-center py-16" role="status" aria-label="Loading">
      <span className="think-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-600" />
      <span className="think-dot mx-1.5 h-2 w-2 rounded-full bg-neutral-400 [animation-delay:120ms] dark:bg-neutral-600" />
      <span className="think-dot h-2 w-2 rounded-full bg-neutral-400 [animation-delay:240ms] dark:bg-neutral-600" />
    </div>
  );
}
