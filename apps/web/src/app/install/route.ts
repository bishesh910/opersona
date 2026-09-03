import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/** `curl -fsSL https://opersona.me/install | bash` — served straight from
 *  deploy/install.sh in this checkout, so what runs is exactly what is in the
 *  repo (and readable at this URL before anyone pipes it anywhere). */
export async function GET() {
  try {
    const script = await readFile(join(process.cwd(), '..', '..', 'deploy', 'install.sh'), 'utf8');
    return new Response(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Content-Disposition': 'inline; filename="install.sh"',
      },
    });
  } catch {
    return new Response(
      '# installer unavailable on this instance — get it from the repo:\n'
      + '#   curl -fsSL https://raw.githubusercontent.com/bishesh910/opersona/main/deploy/install.sh | bash\n',
      { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
}
