import type { WorldlineId } from '../../worker/protocol.ts'
import { useT } from '../i18n/index.ts'
import type { Mode } from '../sim/store.ts'
import { AllocationPanel } from './AllocationPanel.tsx'
import { CrossPanel } from './CrossPanel.tsx'
import { MergePanel } from './MergePanel.tsx'
import { PanelCard } from './PanelCard.tsx'

// FEAT: separado do Observatory para o teste renderizar só isto, sem a cena 3D atrás
export function ModePanels({
  mode,
  worldFocus,
  remount,
}: {
  readonly mode: Mode
  readonly worldFocus: WorldlineId
  readonly remount: string
}) {
  const t = useT()
  return (
    <>
      {mode === 'intervene' && (
        <PanelCard id="allocation" title={t('allocation.title')}>
          <AllocationPanel key={remount} />
        </PanelCard>
      )}
      {mode === 'cross' && (
        <PanelCard id="cross" title={t('cross.title', { id: worldFocus })}>
          <CrossPanel key={remount} />
        </PanelCard>
      )}
      {mode === 'merge' && (
        <PanelCard id="merge" title={t('mode.merge')}>
          <MergePanel />
        </PanelCard>
      )}
      {mode === 'build' && (
        <PanelCard id="build" title={t('mode.build')}>
          {/* FEAT: corpo provisório; a árvore de obras chega na próxima tarefa deste plano */}
          <section className="panel build" aria-labelledby="build-title">
            <h2 className="panel__title" id="build-title">
              {t('mode.build')}
            </h2>
            <p className="panel__empty">{t('build.empty')}</p>
          </section>
        </PanelCard>
      )}
    </>
  )
}
