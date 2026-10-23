import { createElement, type ReactNode } from 'react';
import { parseMarkdown, type MarkdownBlock } from '../markdown.js';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
type CodeBlockData = Extract<MarkdownBlock, { type: 'code' }>;

const INLINE_PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;

/** Inline formatting: code span, bold, italic and safe (http/https/mailto) links. */
export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_PATTERN).map((part, index) => {
    if (!part) return null;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code className="inline-code" key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.length > 4 && (part.startsWith('**') && part.endsWith('**') || part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.length > 2 && (part.startsWith('*') && part.endsWith('*') || part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('[')) {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(part);
      if (link) {
        const label = link[1];
        const url = link[2];
        return (
          <a
            key={index}
            className="md-link"
            href={url}
            rel="noreferrer noopener"
            title={`在系统浏览器中打开：${url}`}
            onClick={(event) => {
              event.preventDefault();
              void window.asteria.openExternal(url);
            }}
          >
            {label}
          </a>
        );
      }
    }
    return <span key={index}>{part}</span>;
  });
}

function CodeBlock({ block, copied, onCopied }: { block: CodeBlockData; copied: string; onCopied(key: string): void }) {
  const token = `code-${block.start}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(block.text);
      onCopied(token);
      window.setTimeout(() => onCopied(''), 1200);
    } catch {
      onCopied('');
    }
  }
  return (
    <div className="code-block">
      <div className="code-title">
        <span>{block.language || '文本'}</span>
        <button type="button" className="code-copy" title="复制这段代码" onClick={() => void copy()}>
          {copied === token ? '已复制' : '复制'}
        </button>
      </div>
      <code>{block.text}</code>
    </div>
  );
}

function renderBlock(block: MarkdownBlock, copied: string, onCopied: (key: string) => void): ReactNode {
  const key = `${block.type}-${block.start}`;
  if (block.type === 'heading') {
    const level = Math.min(6, Math.max(1, block.level + 2));
    return createElement(`h${level}` as HeadingTag, { key, className: 'markdown-heading' }, renderInline(block.text));
  }
  if (block.type === 'list') {
    const items = block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
    return block.ordered ? <ol key={key} className="markdown-list">{items}</ol> : <ul key={key} className="markdown-list">{items}</ul>;
  }
  if (block.type === 'code') return <CodeBlock key={key} block={block} copied={copied} onCopied={onCopied} />;
  return <p key={key} className="markdown-paragraph">{renderInline(block.text)}</p>;
}

export function Markdown({ text, copied, onCopied }: { text: string; copied: string; onCopied(key: string): void }) {
  return <>{parseMarkdown(text).map((block) => renderBlock(block, copied, onCopied))}</>;
}
