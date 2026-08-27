'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApprovalCard } from '@/components/chat/ApprovalCard';

export interface PendingApproval {
  id: string; cloneId: string; cloneName: string; conversationId: string | null; kind: 'tool' | 'question';
  tool: string; input: unknown; question?: string; options?: string[]; createdAt: string; canResolve: boolean;
}

export function ApprovalsList({ items }: { items: PendingApproval[] }) {
  const router = useRouter();
  if (items.length === 0) return <div className="card muted text-sm">Nothing waiting on you.</div>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="space-y-1">
          <div className="muted flex items-center gap-2 text-xs">
            <span className="font-medium text-neutral-800 dark:text-neutral-200">{a.cloneName}</span>
            <span suppressHydrationWarning>{new Date(a.createdAt).toLocaleString()}</span>
            {a.conversationId && <Link href={`/opersonas/${a.cloneId}/chat/${a.conversationId}`} className="underline">open conversation</Link>}
          </div>
          <ApprovalCard
            item={{ id: a.id, tool: a.tool, input: a.input, question: a.question, options: a.options }}
            canResolve={a.canResolve}
            onResolved={() => router.refresh()}
          />
        </li>
      ))}
    </ul>
  );
}
