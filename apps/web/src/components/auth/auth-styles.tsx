/**
 * "Night Shift" — the shared night vocabulary for the auth pages.
 * The auth backdrop is ALWAYS night, but the app's .dark class may be absent
 * (theme = light), so the regular .input/.card/.btn-primary utilities silently
 * render their light variants there. Everything here is explicit always-dark.
 * Sign-in, sign-up and accept-invite all pull from this one file.
 */

export const NIGHT = {
  FIELD:
    'auth-input h-12 w-full rounded-md border-2 border-[#262c44] bg-[#141930] px-3 text-[15px] ' +
    'text-neutral-100 placeholder:text-neutral-500 shadow-[inset_0_2px_0_rgba(0,0,0,0.35)] ' +
    'outline-none transition-colors duration-150 focus:border-amber-300/70 focus:ring-2 ' +
    'focus:ring-amber-300/20 max-sm:text-base',
  LABEL:
    'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400',
  BTN:
    'h-12 w-full select-none rounded-md border border-amber-500/60 bg-amber-400 px-3 text-[15px] ' +
    'font-bold text-[#231303] shadow-[0_4px_0_0_#92400e] ' +
    'transition-[transform,box-shadow,background-color] duration-100 hover:bg-amber-300 ' +
    'active:translate-y-[3px] active:shadow-[0_1px_0_0_#92400e] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ' +
    'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-amber-400 ' +
    'disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0_0_#92400e] motion-reduce:transition-none',
  LINK:
    'rounded-sm font-medium text-amber-300 underline decoration-amber-300/40 underline-offset-[3px] ' +
    'transition-colors hover:text-amber-200 hover:decoration-amber-200/70 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300',
  QUIET_BTN:
    'rounded-sm text-neutral-400 underline decoration-neutral-500/50 underline-offset-[3px] ' +
    'transition-colors hover:text-neutral-200 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300',
  OTP:
    'auth-input h-14 w-full rounded-md border-2 border-[#262c44] bg-[#141930] pl-[0.35em] text-center ' +
    'font-mono text-2xl tracking-[0.35em] text-neutral-100 placeholder:tracking-[0.35em] ' +
    'placeholder:text-neutral-600 shadow-[inset_0_2px_0_rgba(0,0,0,0.35)] outline-none ' +
    'transition-colors focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20',
  BACKUP:
    'auth-input h-12 w-full rounded-md border-2 border-[#262c44] bg-[#141930] px-3 text-center ' +
    'font-mono text-lg tracking-[0.12em] text-neutral-100 placeholder:text-neutral-600 ' +
    'shadow-[inset_0_2px_0_rgba(0,0,0,0.35)] outline-none transition-colors ' +
    'focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20',
  EYE:
    'absolute inset-y-0 right-1 my-auto flex h-8 w-8 items-center justify-center rounded-md ' +
    'text-neutral-500 transition-colors hover:text-neutral-200 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300',
};

/** Calm error chip: square pixel bullet, server message verbatim, never clears input. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rise-in flex items-start gap-2 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] leading-snug text-red-200">
      <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 bg-red-300" />
      <span>{children}</span>
    </p>
  );
}
