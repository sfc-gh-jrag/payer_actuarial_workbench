import { Fragment, type ReactNode } from "react"

/**
 * Minimal, dependency-free markdown renderer for agent chat responses.
 * Supports: #/##/### headings, **bold**, *italic* / _italic_, `inline code`,
 * [links](url), unordered (- / *) and ordered (1.) lists, and paragraphs.
 * Builds React nodes only — no dangerouslySetInnerHTML — so it is XSS-safe.
 */

const INLINE = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  let i = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={key}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>)
    } else if (tok.startsWith("_")) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>)
    } else {
      // [label](url)
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      if (mm) {
        nodes.push(
          <a key={key} href={mm[2]} target="_blank" rel="noopener noreferrer">
            {mm[1]}
          </a>,
        )
      } else {
        nodes.push(tok)
      }
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p${k++}`}>{renderInline(para.join(" "), `p${k}`)}</p>)
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, idx) => (
        <li key={idx}>{renderInline(it, `li${k}-${idx}`)}</li>
      ))
      blocks.push(
        list.ordered ? <ol key={`l${k++}`}>{items}</ol> : <ul key={`l${k++}`}>{items}</ul>,
      )
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)

    if (heading) {
      flushPara(); flushList()
      const level = Math.min(heading[1].length, 3)
      const Tag = (`h${level + 2}` as "h3" | "h4" | "h5")
      blocks.push(<Tag key={`h${k++}`}>{renderInline(heading[2], `h${k}`)}</Tag>)
    } else if (ul) {
      flushPara()
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] } }
      list.items.push(ul[1])
    } else if (ol) {
      flushPara()
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] } }
      list.items.push(ol[1])
    } else if (line.trim() === "") {
      flushPara(); flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara(); flushList()

  return <div className="wb-md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
