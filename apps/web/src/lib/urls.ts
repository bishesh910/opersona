/** Short URLs. Own persona → /me/…; others → /clones/<id>/…; conversations → /c/<slug>. */
export const personaPath = (cloneId: string, isOwner: boolean, tab = '') =>
  (isOwner ? '/me' : `/clones/${cloneId}`) + (tab ? `/${tab}` : '');
export const chatPath = (slug: string) => `/c/${slug}`;
