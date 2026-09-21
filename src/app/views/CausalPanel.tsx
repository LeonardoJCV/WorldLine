import { useEffect, useMemo, useRef } from 'react'
import { buildCausalTree, type CausalNode } from '../causal/tree.ts'
import { formatComparison, formatYear, metricKey } from '../i18n/format.ts'
import { useLocale, useT } from '../i18n/index.ts'
import { simulation, useSimulation } from '../sim/runtime.ts'

const COLUMN = 232
const NODE_WIDTH = 200
const NODE_HEIGHT = 48
const ROW = 60
const PAD = 8

export function CausalPanel() {
  const t = useT()
  const locale = useLocale()
  const events = useSimulation((s) => s.events)
  const selected = useSimulation((s) => s.selected)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tree = useMemo(
    () => (selected === null ? null : buildCausalTree(events, selected)),
    [events, selected],
  )

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [selected])

  const root = selected === null ? undefined : events[selected]
  if (!tree || !root) {
    return (
      <section className="panel causal" aria-labelledby="causal-title">
        <h2 className="panel__title" id="causal-title">
          {t('causal.title')}
        </h2>
        <p className="panel__empty">{t('causal.empty')}</p>
      </section>
    )
  }

  const { select, setCursor } = simulation.getState()
  const x = (depth: number) => PAD + (tree.depth - depth) * COLUMN
  const y = (row: number) => PAD + row * ROW
  const width = PAD * 2 + tree.depth * COLUMN + NODE_WIDTH
  const height = PAD * 2 + Math.max(tree.rows, 1) * ROW
  const byKey = new Map(tree.nodes.map((node) => [node.key, node]))

  const describe = (node: CausalNode): readonly [string, string] => {
    switch (node.kind) {
      case 'event': {
        const record = events[node.record]
        if (!record) return [t('causal.unknown'), '']
        const years =
          record.end === null || record.end === record.start
            ? formatYear(record.start)
            : `${formatYear(record.start)}–${formatYear(record.end)}`
        return [t(`event.${record.event}`), node.repeated ? t('causal.repeated') : years]
      }
      case 'condition': {
        const { metric, value, op, threshold } = node.cause
        const [a, b] = formatComparison(metric, value, threshold, locale)
        return [t(metricKey(metric)), `${a} ${op} ${b}`]
      }
      case 'decision':
        return [
          t('causal.decision', { year: formatYear(node.cause.tick) }),
          node.cause.sectors.map((sector) => t(`sector.${sector}`)).join(', '),
        ]
    }
  }

  return (
    <section className="panel causal" aria-labelledby="causal-title">
      <h2 className="panel__title" id="causal-title">
        {t('causal.title')}
      </h2>
      <div className="causal__scroll" ref={scrollRef}>
        <div
          className="causal__canvas"
          role="group"
          aria-label={t('causal.label', { event: t(`event.${root.event}`) })}
          style={{ width, height }}
        >
          <svg className="causal__links" width={width} height={height} aria-hidden="true">
            {tree.nodes.map((node) => {
              const parent = node.parent === null ? undefined : byKey.get(node.parent)
              if (!parent) return null
              const x1 = x(node.depth) + NODE_WIDTH
              const y1 = y(node.row) + NODE_HEIGHT / 2
              const x2 = x(parent.depth)
              const y2 = y(parent.row) + NODE_HEIGHT / 2
              const mid = (x1 + x2) / 2
              return (
                <path
                  key={node.key}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                />
              )
            })}
          </svg>
          {tree.nodes.map((node) => {
            const [title, detail] = describe(node)
            const style = {
              left: x(node.depth),
              top: y(node.row),
              width: NODE_WIDTH,
              height: NODE_HEIGHT,
            }
            const body = (
              <>
                <span className="causal__title">{title}</span>
                <span className="causal__detail">{detail}</span>
              </>
            )
            if (node.kind === 'condition') {
              return (
                <div key={node.key} className="causal__node" data-kind="condition" style={style}>
                  {body}
                </div>
              )
            }
            return (
              <button
                key={node.key}
                type="button"
                className="causal__node"
                data-kind={node.kind}
                data-root={node.depth === 0}
                style={style}
                onClick={
                  node.kind === 'event'
                    ? () => select(node.record)
                    : () => setCursor(node.cause.tick)
                }
              >
                {body}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
