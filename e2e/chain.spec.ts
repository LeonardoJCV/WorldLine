import { expect, test } from '@playwright/test'
import { ERA_LABEL_INK } from '../src/app/current/geometry.ts'
import { LABEL_FONT, LABEL_FONT_STRONG } from '../src/app/current/draw.ts'
import { en } from '../src/app/i18n/en.ts'
import { ptBR } from '../src/app/i18n/pt-BR.ts'
import { EVENTS } from '../src/engine/events.ts'
import { useGraphics } from './stage.ts'

// FEAT: os nomes que a corrente desenha de verdade — cada era nos dois idiomas, lidos da tabela
const ERA_NAMES = EVENTS.flatMap((def) =>
  def.kind === 'era' ? [en[`event.${def.id}`], ptBR[`event.${def.id}`]] : [],
)

// FIX: nada na suíte de unidade prende ERA_LABEL_INK ao texto real — a constante podia cair a 7 com
// tudo verde, e uma troca de tipo devolveria em silêncio a sobreposição que este portão removeu
test('never lets a drawn era name grow taller than the gap the chain keeps for it', async ({
  page,
}) => {
  await useGraphics(page, '2d')
  await page.goto('/?seed=482913')
  await expect(page.getByTestId('seed')).toHaveText('482913')
  expect(ERA_NAMES).toHaveLength(10)

  const measured = await page.evaluate(
    async ({ names, fonts }) => {
      await document.fonts.ready
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) return null
      let ink = 0
      let tallest = ''
      for (const font of fonts) {
        ctx.font = font
        for (const name of names) {
          const box = ctx.measureText(name)
          const height = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent
          if (height > ink) {
            ink = height
            tallest = `${font} / ${name}`
          }
        }
      }
      return { ink, tallest, loaded: document.fonts.check('12px "Archivo Variable"') }
    },
    { names: ERA_NAMES, fonts: [LABEL_FONT, LABEL_FONT_STRONG] },
  )

  expect(measured).not.toBeNull()
  // FEAT: sem a fonte do app carregada a medida seria a do fallback, e não diria nada sobre o app
  expect(measured?.loaded, 'Archivo Variable never loaded').toBe(true)
  expect(measured?.ink).toBeGreaterThan(0)
  expect(
    ERA_LABEL_INK,
    `tallest: ${measured?.tallest} at ${measured?.ink}px`,
  ).toBeGreaterThanOrEqual(measured?.ink ?? 0)
})
