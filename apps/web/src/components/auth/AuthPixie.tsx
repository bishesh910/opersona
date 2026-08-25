'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { AvatarRecipe } from '@opersona/shared';
import { AvatarCanvas } from '@/components/avatar/AvatarCanvas';
import { randomRecipe } from '@/components/onboarding/random-recipe';

/**
 * A random Pixie peeks over the auth card's top edge, blinking idly — and doubles
 * as the status indicator: forms flip it to 'thinking' while working or waiting
 * on a 2FA code. The layout owns the Pixie (every auth page gets it for free);
 * forms report mood through this context.
 */
const PixieMoodCtx = createContext<(s: 'idle' | 'thinking') => void>(() => {});
export const usePixieMood = () => useContext(PixieMoodCtx);

export function AuthPixieFrame({ children }: { children: React.ReactNode }) {
  const [recipe, setRecipe] = useState<AvatarRecipe | null>(null);
  const [mood, setMood] = useState<'idle' | 'thinking'>('idle');
  // Client-only randomness → no SSR hydration mismatch; the canvas pops in imperceptibly.
  useEffect(() => { setRecipe(randomRecipe()); }, []);
  return (
    <PixieMoodCtx.Provider value={setMood}>
      <div className="relative">
        {/* 72×112 CSS-px sprite (scale=4) cropped to its top 88px: head, neck and the top of
            the shoulder dome reach the card edge, so the body reads as standing BEHIND the
            card. Hidden under 360px so it never collides with the mobile wordmark. */}
        <div aria-hidden className="pointer-events-none absolute -top-[88px] right-7 h-[88px] w-[72px] overflow-hidden max-[359px]:hidden">
          {recipe && <AvatarCanvas recipe={recipe} scale={4} state={mood} className="block" />}
        </div>
        {children}
      </div>
    </PixieMoodCtx.Provider>
  );
}
