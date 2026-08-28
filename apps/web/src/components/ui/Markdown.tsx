'use client';
import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as never[];

/** Pull the plain text out of the rendered <code> children so "Copy" copies exactly what is shown. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = children as { props?: { className?: string; children?: ReactNode } } | undefined;
  const cls = code?.props?.className ?? '';
  const lang = /language-([\w+-]+)/.exec(cls)?.[1] ?? '';
  async function copy() {
    try { await navigator.clipboard.writeText(textOf(code?.props?.children).replace(/\n$/, '')); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  }
  return (
    <div className="md-code group relative my-2 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        <span className="font-mono">{lang || 'text'}</span>
        <button type="button" onClick={copy} className="rounded px-1.5 py-0.5 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-700 dark:hover:text-neutral-100" aria-label="Copy code">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 text-xs leading-relaxed">{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children, ...rest }) => {
    // Fenced blocks arrive with a language- class (or inside <pre>); inline code has neither.
    const inline = !className && typeof children === 'string' && !children.includes('\n');
    return inline
      ? <code className="rounded bg-neutral-200/70 px-1 py-0.5 font-mono text-[0.85em] dark:bg-neutral-700/70" {...rest}>{children}</code>
      : <code className={className} {...rest}>{children}</code>;
  },
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-400 underline-offset-2 hover:decoration-current">{children}</a>,
  table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="min-w-max border-collapse text-xs">{children}</table></div>,
  th: ({ children }) => <th className="border border-neutral-300 bg-neutral-200/60 px-2 py-1 text-left font-semibold dark:border-neutral-600 dark:bg-neutral-700/60">{children}</th>,
  td: ({ children }) => <td className="border border-neutral-300 px-2 py-1 align-top dark:border-neutral-600">{children}</td>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-medium first:mt-0">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-neutral-400 pl-3 text-neutral-600 dark:text-neutral-300">{children}</blockquote>,
  hr: () => <hr className="my-3 border-neutral-300 dark:border-neutral-600" />,
  img: ({ src, alt }) => <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="my-1 max-w-full rounded" />,
};

/** GFM markdown (tables, task lists, strikethrough) with highlighted code. Safe: no raw HTML is rendered. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'md break-words ' + (className ?? '')}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{text}</ReactMarkdown>
    </div>
  );
});
