/** Short URLs. Own persona → /me/…; others → /opersonas/<id>/…; conversations → /c/<slug>. */
export const personaPath = (cloneId: string, isOwner: boolean, tab = '') =>
  (isOwner ? '/me' : `/opersonas/${cloneId}`) + (tab ? `/${tab}` : '');
export const chatPath = (slug: string) => `/c/${slug}`;
