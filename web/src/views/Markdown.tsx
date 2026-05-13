import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Compact markdown renderer for agent messages. Maps common nodes to
 * Range's palette so code, lists, blockquotes, and tables look at home
 * inside the conversation timeline. No HTML pass-through (default) so
 * we don't have to worry about injection from agent output.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
          ul: (props) => (
            <ul className="list-disc pl-5 my-2 space-y-0.5" {...props} />
          ),
          ol: (props) => (
            <ol className="list-decimal pl-5 my-2 space-y-0.5" {...props} />
          ),
          li: (props) => <li className="leading-relaxed" {...props} />,
          h1: (props) => (
            <h1
              className="font-display text-[18px] font-medium tracking-tight mt-3 mb-2"
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="font-display text-[16px] font-medium tracking-tight mt-3 mb-1.5"
              {...props}
            />
          ),
          h3: (props) => (
            <h3
              className="text-[14px] font-semibold mt-3 mb-1.5"
              {...props}
            />
          ),
          h4: (props) => (
            <h4
              className="text-[13px] font-semibold mt-2 mb-1"
              {...props}
            />
          ),
          a: ({ href, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:underline break-all"
              {...rest}
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-[var(--br-3)] pl-3 my-2 text-fg-2 italic"
              {...props}
            />
          ),
          hr: () => <hr className="my-3 border-[var(--br-1)]" />,
          strong: (props) => (
            <strong className="font-semibold text-fg" {...props} />
          ),
          em: (props) => <em className="italic" {...props} />,
          code: ({ className, children, ...rest }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <code
                  className={`${className ?? ""} block`}
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="font-mono text-[12px] bg-[var(--bg)] border border-[var(--br-1)] rounded px-1 py-[1px]"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children, ...rest }) => (
            <pre
              className="font-mono text-[12px] leading-[1.55] bg-[var(--bg)] border border-[var(--br-1)] rounded p-2.5 my-2 overflow-x-auto whitespace-pre"
              {...rest}
            >
              {children}
            </pre>
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table
                className="text-[12.5px] border-collapse border border-[var(--br-1)]"
                {...props}
              />
            </div>
          ),
          th: (props) => (
            <th
              className="text-left px-2 py-1 border border-[var(--br-1)] bg-[var(--bg-2)] font-medium"
              {...props}
            />
          ),
          td: (props) => (
            <td
              className="px-2 py-1 border border-[var(--br-1)] align-top"
              {...props}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
