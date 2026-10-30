import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
}) => {
  return (
    <div className={`space-y-2 text-xs sm:text-sm leading-relaxed ${className}`}>
      {renderBlocks(content)}
    </div>
  );
};

function renderBlocks(raw: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const lines = raw.split(/\r?\n/);

  let i = 0;
  let keyIdx = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Code blocks (```lang ... ```)
    if (line.trim().startsWith('```')) {
      const match = line.trim().match(/^```([a-zA-Z0-9_-]*)/);
      const language = match && match[1] ? match[1] : 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      blocks.push(
        <CodeBlock key={`block-${keyIdx++}`} code={codeLines.join('\n')} language={language} />
      );
      continue;
    }

    // 2. Table (| col1 | col2 |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      blocks.push(<TableBlock key={`block-${keyIdx++}`} lines={tableLines} />);
      continue;
    }

    // 3. Blockquote (> quote)
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={`block-${keyIdx++}`}
          className="border-l-2 border-gold-500/70 bg-gold-950/20 px-3 py-1.5 my-2 rounded-r-lg text-slate-300 italic text-[11px] sm:text-xs"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 4. Headers (#, ##, ###)
    if (line.startsWith('### ')) {
      blocks.push(
        <h4 key={`block-${keyIdx++}`} className="font-bold text-slate-100 text-sm mt-3 mb-1 flex items-center gap-1.5">
          {renderInline(line.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push(
        <h3 key={`block-${keyIdx++}`} className="font-bold text-gold-300 text-base mt-3.5 mb-1.5 border-b border-slate-800 pb-1">
          {renderInline(line.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push(
        <h2 key={`block-${keyIdx++}`} className="font-extrabold text-white text-lg mt-4 mb-2 border-b border-gold-500/30 pb-1">
          {renderInline(line.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    // 5. Horizontal rule (---)
    if (line.trim() === '---' || line.trim() === '***') {
      blocks.push(
        <hr key={`block-${keyIdx++}`} className="border-t border-slate-800 my-2.5" />
      );
      i++;
      continue;
    }

    // 6. Lists (- bullet or * bullet or 1. ordered)
    if (line.trim().match(/^[-*]\s+/) || line.trim().match(/^\d+\.\s+/)) {
      const listItems: { text: string; isOrdered: boolean }[] = [];
      const isOrdered = Boolean(line.trim().match(/^\d+\.\s+/));

      while (i < lines.length) {
        const cur = lines[i].trim();
        const bulletMatch = cur.match(/^[-*]\s+(.*)$/);
        const orderedMatch = cur.match(/^\d+\.\s+(.*)$/);

        if (bulletMatch) {
          listItems.push({ text: bulletMatch[1], isOrdered: false });
          i++;
        } else if (orderedMatch) {
          listItems.push({ text: orderedMatch[1], isOrdered: true });
          i++;
        } else {
          break;
        }
      }

      if (isOrdered) {
        blocks.push(
          <ol key={`block-${keyIdx++}`} className="list-decimal list-inside space-y-1 my-1.5 text-slate-200">
            {listItems.map((item, lIdx) => (
              <li key={lIdx} className="leading-relaxed">
                {renderInline(item.text)}
              </li>
            ))}
          </ol>
        );
      } else {
        blocks.push(
          <ul key={`block-${keyIdx++}`} className="space-y-1 my-1.5 text-slate-200">
            {listItems.map((item, lIdx) => (
              <li key={lIdx} className="flex items-start gap-2 leading-relaxed">
                <span className="text-gold-400 mt-1 shrink-0">•</span>
                <span className="flex-1">{renderInline(item.text)}</span>
              </li>
            ))}
          </ul>
        );
      }
      continue;
    }

    // 7. Regular paragraph
    if (line.trim().length > 0) {
      blocks.push(
        <p key={`block-${keyIdx++}`} className="leading-relaxed text-slate-200">
          {renderInline(line)}
        </p>
      );
    }
    i++;
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // 1. Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code
          key={`inl-${key++}`}
          className="rounded bg-navy-900 border border-slate-700/60 px-1.5 py-0.5 text-gold-300 font-mono text-[11px] sm:text-xs"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 2. Bold & Italic: ***text***
    const boldItalicMatch = remaining.match(/^\*\*\*([^*]+)\*\*\*/);
    if (boldItalicMatch) {
      parts.push(
        <strong key={`inl-${key++}`} className="font-bold italic text-white">
          {boldItalicMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldItalicMatch[0].length);
      continue;
    }

    // 3. Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <strong key={`inl-${key++}`} className="font-semibold text-slate-100">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 4. Italic: *text* or _text_
    const italicMatch = remaining.match(/^\*([^*]+)\*/) || remaining.match(/^_([^_]+)_/);
    if (italicMatch) {
      parts.push(
        <em key={`inl-${key++}`} className="italic text-slate-300">
          {italicMatch[1]}
        </em>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 5. Link: [label](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={`inl-${key++}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold-400 hover:text-gold-300 underline underline-offset-2 transition"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text up to next special character
    const nextSpecial = remaining.search(/[`*_\[]/);
    if (nextSpecial === -1) {
      parts.push(<span key={`inl-${key++}`}>{remaining}</span>);
      break;
    } else if (nextSpecial === 0) {
      // Unmatched special character
      parts.push(<span key={`inl-${key++}`}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      parts.push(<span key={`inl-${key++}`}>{remaining.slice(0, nextSpecial)}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts;
}

const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-[#070b14] overflow-hidden my-2.5 shadow-md">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-navy-900/90 border-b border-slate-800/80 text-[11px] font-mono text-slate-400">
        <span className="text-gold-400 lowercase">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 hover:text-slate-200 transition cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[var(--semantic-success)]" />
              <span className="text-[var(--semantic-success)]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-[11px] sm:text-xs font-mono text-gold-200 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const TableBlock: React.FC<{ lines: string[] }> = ({ lines }) => {
  if (lines.length < 2) return null;

  const parseRow = (line: string) =>
    line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

  const header = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  return (
    <div className="overflow-x-auto my-2 rounded-xl border border-slate-800 shadow-md">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-navy-900/90 border-b border-slate-800 text-gold-300 font-mono text-[11px]">
            {header.map((col, idx) => (
              <th key={idx} className="px-3 py-2">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 bg-[#070d1a]/80 text-slate-200 font-mono text-[11px]">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-navy-900/50">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
