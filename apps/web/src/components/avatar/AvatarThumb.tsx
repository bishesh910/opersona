'use client';
import type { AvatarRecipe } from '@opersona/shared';
import { AvatarCanvas, type AvatarState } from './AvatarCanvas';

/** Small avatar for lists/headers; falls back to an initial when no recipe is set. */
export function AvatarThumb({ recipe, name, scale = 2, talking = false, state }: { recipe: AvatarRecipe | null | undefined; name: string; scale?: number; talking?: boolean; state?: AvatarState }) {
  if (recipe) return <AvatarCanvas recipe={recipe} scale={scale} title={name} className="rounded" state={state ?? (talking ? 'talking' : 'idle')} />;
  return (
    <div
      className="flex items-center justify-center rounded bg-neutral-200 text-sm font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      style={{ width: 18 * scale, height: 28 * scale }}
      title={name}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}
