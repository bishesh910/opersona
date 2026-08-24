import { redirect } from 'next/navigation';

export default async function ClonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(id === 'me' ? '/me' : `/clones/${id}/thinking`);
}
