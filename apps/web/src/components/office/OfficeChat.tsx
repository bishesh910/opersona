'use client';
/**
 * The office side-chat: the REAL ChatView (streaming, attachments, feedback,
 * approvals) embedded in the persona panel — munder-difflin's sidebar
 * terminal, except the thing on the other end is the colleague's persona.
 * Resumes your latest thread with them; "open full view" jumps to the big
 * chat surface for the same conversation.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AvatarRecipe } from '@opersona/shared';
import { openOfficeChat, type OfficeChatPayload } from '@/actions/office';
import { ChatView } from '@/components/chat/ChatView';

export function OfficeChat({ cloneId, avatar }: { cloneId: string; avatar: AvatarRecipe | null }) {
  const [data, setData] = useState<OfficeChatPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setData(null); setError(null);
    openOfficeChat(cloneId)
      .then((d) => { if (dead) return; if ('error' in d) setError(d.error); else setData(d); })
      .catch(() => { if (!dead) setError("Couldn't open the chat — try again."); });
    return () => { dead = true; };
  }, [cloneId]);

  if (error) return <p className="muted p-3 text-xs">{error}</p>;
  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
        <span className="h-2 w-2 animate-pulse bg-amber-500" aria-hidden />
        <p className="muted text-xs">opening the chat…</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-office-chat>
      <ChatView
        key={data.conversationId}
        mode="clone"
        embedded
        visitorView={!data.isOwner}
        cloneId={cloneId}
        cloneName={data.cloneName}
        avatar={avatar}
        conversationId={data.conversationId}
        title={data.title}
        model={data.model}
        effort={data.effort as React.ComponentProps<typeof ChatView>['effort']}
        history={data.history}
        feedback={data.feedback}
        readOnly={false}
        canResolveApprovals={data.canResolveApprovals}
        userFirstName={data.userFirstName}
        showCost={data.showCost}
        keyMissing={data.keyMissing ? 'mine' : null}
        initialLive={data.live}
      />
      <div className="border-t border-neutral-100 px-2 py-1 text-right dark:border-neutral-800">
        <Link
          className="muted text-[11px] hover:underline"
          href={data.isOwner ? `/c/${data.slug}` : `/ask/${cloneId}/${data.slug}`}
        >
          open in full view →
        </Link>
      </div>
    </div>
  );
}
