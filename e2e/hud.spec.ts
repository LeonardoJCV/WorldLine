import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'
import {
  branchFromStart,
  installParadox,
  pickOrigin,
  runToParadox,
  worldAtYear,
} from './support.ts'

const WIDE = { width: 1440, height: 900 }

async function observe(page: Page) {
  await useGraphics(page, '2d')
  await page.setViewportSize(WIDE)
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
}

function boxes(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      if (!found) return null
      return { top: found.top, bottom: found.bottom, left: found.left, height: found.height }
    }
    return { bar: rect('.topbar'), stage: rect('.stage'), hud: rect('.hud'), view: innerHeight }
  })
}

test('the stage takes the whole screen below the top bar', async ({ page }) => {
  await observe(page)
  const { bar, stage, hud, view } = await boxes(page)
  if (!bar || !stage || !hud) throw new Error('the observatory did not render its layers')
  expect(Math.abs(stage.top - bar.bottom)).toBeLessThanOrEqual(1)
  expect(Math.abs(stage.bottom - view)).toBeLessThanOrEqual(1)
  expect(stage.height).toBeGreaterThan(view * 0.8)
  // FEAT: a camada dos cartões cobre o palco, e não uma faixa própria
  expect(hud.top).toBeGreaterThanOrEqual(stage.top - 1)
  expect(hud.bottom).toBeLessThanOrEqual(stage.bottom + 1)
})

test('the canvas measures the whole stage', async ({ page }) => {
  await observe(page)
  const measures = await page.evaluate(() => {
    const canvas = document.querySelector('.current')
    const stage = document.querySelector('.stage')?.getBoundingClientRect()
    if (!(canvas instanceof HTMLCanvasElement) || !stage) return null
    const box = canvas.getBoundingClientRect()
    return { canvas: box.height, stage: stage.height, drawn: canvas.height }
  })
  if (!measures) throw new Error('the 2d current did not render')
  expect(Math.abs(measures.canvas - measures.stage)).toBeLessThanOrEqual(1)
  expect(measures.drawn).toBeGreaterThanOrEqual(measures.stage)
})

test('the universe answers the pointer between the cards', async ({ page }) => {
  await observe(page)
  const { stage } = await boxes(page)
  if (!stage) throw new Error('the stage did not render')
  const axis = Math.round(stage.top + stage.height / 2)
  const open = Math.round(stage.left + 640)
  const gap = axis + 40

  const onCanvas = (x: number, y: number) =>
    page.evaluate(
      ([px, py]) => document.elementFromPoint(px as number, py as number)?.className ?? '',
      [x, y],
    )
  expect(await onCanvas(open, gap)).toContain('current')

  const history = page.getByRole('slider', { name: /Worldline history/ })
  const present = Number(await history.getAttribute('aria-valuemax'))
  await page.mouse.move(open, gap)
  await page.mouse.down()
  await page.mouse.move(open - 240, gap, { steps: 8 })
  await page.mouse.up()
  await expect(history).not.toHaveAttribute('aria-valuenow', String(present))
  const dragged = Number(await history.getAttribute('aria-valuenow'))
  expect(dragged).toBeLessThan(present)

  const fit = page.getByRole('button', { name: 'Show all' })
  await expect(fit).toBeDisabled()
  await page.mouse.move(open, gap)
  await page.mouse.wheel(0, -120)
  await expect(fit).toBeEnabled()
  await fit.click()

  // FEAT: o marcador de era mora no eixo, e o cursor do ponteiro avisa quando está sobre um
  const hit = await page.locator('.current').evaluate((node, y) => {
    for (let x = Math.round(node.getBoundingClientRect().left) + 320; x < 880; x += 4) {
      node.style.cursor = ''
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
      if (node.style.cursor === 'pointer') return x
    }
    return 0
  }, axis)
  expect(hit).toBeGreaterThan(0)
  expect(await onCanvas(hit, axis)).toContain('current')
  await page.mouse.click(hit, axis)
  await expect(page.locator('.causal__node').first()).toBeVisible()
})

test('every card takes its own area and the minimap keeps the floor', async ({ page }) => {
  await observe(page)
  const places = await page.evaluate(() => {
    const rect = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      return found ? { top: found.top, bottom: found.bottom, left: found.left } : null
    }
    return {
      stage: rect('.stage'),
      state: rect('.card--state'),
      events: rect('.card--events'),
      causal: rect('.card--causal'),
      actions: rect('.card--actions'),
      minimap: rect('.minimap'),
      zoom: rect('.zoom'),
      view: innerHeight,
    }
  })
  const { stage, state, events, causal, actions, minimap, zoom, view } = places
  if (!stage || !state || !events || !causal || !actions || !minimap || !zoom) {
    throw new Error('the dashboard did not render its areas')
  }
  // FEAT: uma coluna de cada lado, ambas presas ao alto, com o centro do palco livre
  expect(state.left).toBeLessThan(events.left)
  expect(state.top - stage.top).toBeLessThan(40)
  expect(events.top - stage.top).toBeLessThan(40)
  // FEAT: o porquê lê-se colado à lista que explica
  expect(causal.top - events.bottom).toBeLessThanOrEqual(24)
  expect(causal.left).toBe(events.left)
  // FEAT: a faixa de baixo fica acima do zoom e do minimapa, e o minimapa cabe inteiro na tela
  expect(actions.bottom).toBeLessThanOrEqual(zoom.top)
  expect(zoom.bottom).toBeLessThanOrEqual(minimap.top)
  expect(minimap.bottom).toBeLessThanOrEqual(view)
})

test('a folded card keeps its title, gives back the room and is still folded after a reload', async ({
  page,
}) => {
  await observe(page)
  const card = page.locator('.card--events')
  const tall = (await card.boundingBox())?.height ?? 0
  const fold = page.getByRole('button', { name: 'Collapse Events' })
  await expect(fold).toHaveAttribute('aria-expanded', 'true')
  await fold.click()

  const unfold = page.getByRole('button', { name: 'Expand Events' })
  await expect(unfold).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.panel.events')).toHaveCount(0)
  const short = (await card.boundingBox())?.height ?? 0
  expect(short).toBeLessThan(tall / 2)

  // FEAT: encolhido, o conteúdo saiu do DOM, e por isso não recebe foco no Tab
  await unfold.focus()
  await page.keyboard.press('Tab')
  const escaped = await page.evaluate(
    () => document.activeElement?.closest('.card--events') === null,
  )
  expect(escaped).toBe(true)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand Events' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(page.locator('.panel.events')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Events' }).click()
  await expect(page.locator('.panel.events')).toHaveCount(1)
})

test('the paradox notice is not a card and cannot be folded', async ({ page }) => {
  test.slow()
  await useGraphics(page, '2d')
  await page.setViewportSize(WIDE)
  await installParadox(page)
  await runToParadox(page)
  const notice = page.locator('.paradox')
  await expect(notice).toBeVisible()
  expect(await notice.locator('button').count()).toBe(0)
  expect(await notice.evaluate((node) => node.closest('.card') === null)).toBe(true)
})

const PHONE = { width: 390, height: 844 }

async function observeOnPhone(page: Page) {
  await useGraphics(page, '2d')
  await page.setViewportSize(PHONE)
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
}

function sheetBoxes(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      if (!found) return null
      return {
        top: found.top,
        bottom: found.bottom,
        left: found.left,
        width: found.width,
        height: found.height,
      }
    }
    return {
      stage: rect('.stage'),
      sheet: rect('.sheet'),
      planet: rect('.planet-slot'),
      view: innerHeight,
    }
  })
}

function handleOf(page: Page) {
  return page.getByRole('button', { name: /^Panels/ })
}

// FIX: a folha desliza; a altura só vale depois de ela assentar
function restHeight(page: Page) {
  return async () => {
    const { sheet, stage } = await sheetBoxes(page)
    return sheet && stage ? sheet.height / stage.height : 0
  }
}

test('the handle alone carries the sheet through its three heights', async ({ page }) => {
  await observeOnPhone(page)
  const sheet = page.locator('.sheet')
  const handle = handleOf(page)
  await expect(sheet).toHaveAttribute('data-state', 'peek')
  await expect(handle).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(restHeight(page)).toBeCloseTo(0.4, 1)
  const peek = await sheetBoxes(page)
  if (!peek.sheet || !peek.stage) throw new Error('the sheet did not render')
  expect(Math.abs(peek.sheet.bottom - peek.view)).toBeLessThanOrEqual(1)

  // FEAT: o teclado sozinho percorre as três alturas, sem depender de arrasto
  await handle.focus()
  await page.keyboard.press('Enter')
  await expect(sheet).toHaveAttribute('data-state', 'open')
  await expect.poll(restHeight(page)).toBeCloseTo(0.85, 1)
  await expect(page.locator('.sheet .card--state')).toBeVisible()

  await page.keyboard.press(' ')
  await expect(sheet).toHaveAttribute('data-state', 'hidden')
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(restHeight(page)).toBeLessThan(0.2)
  // FEAT: escondida, os cartões saem do DOM e o essencial fica
  await expect(page.locator('.sheet .card')).toHaveCount(0)
  await expect(page.locator('.sheet__essentials')).toBeVisible()
  await expect(page.locator('.sheet__essentials')).toContainText('Population')
  // FEAT: o aviso de paradoxo mora fora do que a folha esconde, nunca dentro dos cartões
  const notice = await page.evaluate(() => {
    const node = document.querySelector('.hud--sheet > .notices')
    return { outside: node !== null, buried: node?.closest('.sheet') !== null }
  })
  expect(notice.outside).toBe(true)
  expect(notice.buried).toBe(false)

  await page.keyboard.press('Enter')
  await expect(sheet).toHaveAttribute('data-state', 'peek')
})

test('the universe keeps the screen behind the hidden sheet and still answers the pointer', async ({
  page,
}) => {
  await observeOnPhone(page)
  const handle = handleOf(page)
  await handle.click()
  await handle.click()
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'hidden')
  await expect.poll(restHeight(page)).toBeLessThan(0.2)

  const { stage, sheet, planet } = await sheetBoxes(page)
  if (!stage || !sheet || !planet) throw new Error('the stage did not render')
  // FEAT: o planeta e a corrente moram acima da folha, não por baixo dela
  expect(planet.top).toBeGreaterThanOrEqual(stage.top - 1)
  expect(planet.bottom).toBeLessThanOrEqual(sheet.top)
  expect(sheet.top - stage.top).toBeGreaterThan(stage.height * 0.8)

  const x = Math.round(stage.left + stage.width * 0.4)
  const y = Math.round(sheet.top - 12)
  const under = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px as number, py as number)?.className ?? '',
    [x, y],
  )
  expect(under).toContain('current')

  const history = page.getByRole('slider', { name: /Worldline history/ })
  const present = Number(await history.getAttribute('aria-valuemax'))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 140, y, { steps: 8 })
  await page.mouse.up()
  await expect(history).not.toHaveAttribute('aria-valuenow', String(present))
})

test('a drag on the handle settles on the nearest height', async ({ page }) => {
  await observeOnPhone(page)
  const sheet = page.locator('.sheet')
  const box = await page.locator('.sheet__handle').boundingBox()
  if (!box) throw new Error('the handle did not render')
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 260, { steps: 10 })
  await page.mouse.up()
  await expect(sheet).toHaveAttribute('data-state', 'open')

  const risen = await page.locator('.sheet__handle').boundingBox()
  if (!risen) throw new Error('the handle went away')
  const from = Math.round(risen.y + risen.height / 2)
  await page.mouse.move(x, from)
  await page.mouse.down()
  await page.mouse.move(x, from + 500, { steps: 10 })
  await page.mouse.up()
  await expect(sheet).toHaveAttribute('data-state', 'hidden')
})

test('the focus order follows the screen with the sheet open and with it hidden', async ({
  page,
}) => {
  await observeOnPhone(page)
  const handle = handleOf(page)
  await handle.click()
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'open')
  await expect.poll(restHeight(page)).toBeCloseTo(0.85, 1)
  await handle.focus()
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => {
    const active = document.activeElement
    return {
      toggle: active?.className ?? '',
      card: active?.closest('.card')?.className ?? '',
      inside: active?.closest('.sheet__panels') !== null,
    }
  })
  expect(first.toggle).toContain('card__toggle')
  expect(first.card).toContain('card--state')
  expect(first.inside).toBe(true)

  await handle.click()
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'hidden')
  await handle.focus()
  await page.keyboard.press('Tab')
  const escaped = await page.evaluate(() => document.activeElement?.closest('.sheet') === null)
  expect(escaped).toBe(true)
})

const TOUCHED_WHILE_WATCHING = [
  'Observe',
  'Intervene',
  'Cross',
  'Play',
  'Advance one year',
  '×1',
  '×4',
  '×16',
  '×64',
  '×256',
  'Max',
] as const

test('the phone bar leaves the screen to the universe and keeps every control one tap away', async ({
  page,
}) => {
  await observeOnPhone(page)
  const measures = await page.evaluate(() => {
    const height = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().height ?? 0
    return { bar: height('.topbar'), stage: height('.stage'), view: innerHeight }
  })
  // FEAT: a barra cabe em menos de um quinto da tela; o resto é do universo
  expect(measures.bar).toBeLessThan(measures.view * 0.2)
  expect(measures.stage).toBeGreaterThan(measures.view * 0.8)

  for (const name of TOUCHED_WHILE_WATCHING) {
    const control = page.getByRole('button', { name, exact: true })
    await expect(control).toBeInViewport()
    const box = await control.boundingBox()
    if (!box) throw new Error(`${name} did not render`)
    expect(box.height).toBeGreaterThanOrEqual(33)
    expect(box.width).toBeGreaterThanOrEqual(30)
  }

  // FEAT: o ano continua o maior número da barra
  const year = await page.getByTestId('year').boundingBox()
  if (!year) throw new Error('the year did not render')
  expect(year.height).toBeGreaterThanOrEqual(36)
})

test('the phone bar keeps the setup behind one button, out of the DOM until asked', async ({
  page,
}) => {
  await observeOnPhone(page)
  await expect(page.getByTestId('seed')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New world' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Português' })).toHaveCount(0)

  const setup = page.getByRole('button', { name: 'World and language' })
  await expect(setup).toHaveAttribute('aria-expanded', 'false')
  await setup.click()
  await expect(setup).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByRole('button', { name: 'New world' })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Português' })).toBeInViewport()

  // FEAT: o Escape fecha e devolve o foco a quem abriu, como no menu de gráficos
  await page.getByRole('button', { name: 'New world' }).focus()
  await page.keyboard.press('Escape')
  await expect(setup).toHaveAttribute('aria-expanded', 'false')
  await expect(setup).toBeFocused()
  await expect(page.getByTestId('seed')).toHaveCount(0)
})

test('the phone focus order walks the bar as it reads', async ({ page }) => {
  await observeOnPhone(page)
  await page.getByRole('button', { name: 'World and language' }).focus()
  const order: string[] = []
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press('Tab')
    order.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent ??
          '',
      ),
    )
  }
  expect(order).toEqual(['Graphics', 'Observe', 'Intervene', 'Cross'])
})

test('with motion turned down the sheet changes height without sliding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await observeOnPhone(page)
  await handleOf(page).click()
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'open')
  const moment = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet')
    const stage = document.querySelector('.stage')
    if (!sheet || !stage) return null
    return {
      duration: getComputedStyle(sheet).transitionDuration,
      ratio: sheet.getBoundingClientRect().height / stage.getBoundingClientRect().height,
    }
  })
  if (!moment) throw new Error('the sheet did not render')
  // FEAT: a altura muda na hora; o que se desliga é o deslizar
  expect(Number.parseFloat(moment.duration)).toBeLessThan(0.05)
  expect(moment.ratio).toBeCloseTo(0.85, 1)
})

test('with motion turned down a card still folds, just without a height transition', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await observe(page)
  const card = page.locator('.card--events')
  const tall = (await card.boundingBox())?.height ?? 0
  const duration = await card.evaluate((node) => getComputedStyle(node).transitionDuration)
  expect(Number.parseFloat(duration)).toBeLessThan(0.05)
  await page.getByRole('button', { name: 'Collapse Events' }).click()
  await expect(page.locator('.panel.events')).toHaveCount(0)
  const short = (await card.boundingBox())?.height ?? 0
  // FEAT: sem transição a altura muda igual; só o encolher suave é que some
  expect(short).toBeLessThan(tall / 2)
})

test('with motion turned down switching mode still widens the column, just without a transition', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await observe(page)
  const hud = page.locator('.hud')
  const hudDuration = await hud.evaluate((node) => getComputedStyle(node).transitionDuration)
  expect(Number.parseFloat(hudDuration)).toBeLessThan(0.05)
  const before = await hud.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
  await page.getByRole('button', { name: 'Intervene' }).click()
  const allocation = page.locator('.card--allocation')
  await expect(allocation).toBeVisible()
  const animationDuration = await allocation.evaluate(
    (node) => getComputedStyle(node).animationDuration,
  )
  expect(Number.parseFloat(animationDuration)).toBeLessThan(0.05)
  const after = await hud.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
  // FEAT: a coluna larga chega na hora; o que se desliga é o deslocar suave do resto da tela
  expect(after).not.toBe(before)
})

function floorBoxes(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      if (!found) return null
      return { top: found.top, bottom: found.bottom, height: found.height }
    }
    return {
      stage: rect('.stage'),
      scene: rect('.scene3d'),
      sheet: rect('.sheet'),
      notices: rect('.notices'),
      zoom: rect('.zoom'),
      reach: [...document.querySelectorAll('.zoom button')].map((button) => {
        const box = button.getBoundingClientRect()
        const found = document.elementFromPoint(
          (box.left + box.right) / 2,
          (box.top + box.bottom) / 2,
        )
        return found !== null && (found === button || button.contains(found))
      }),
    }
  })
}

test('the paradox owns the phone floor, and keeps it inside the planet', async ({ page }) => {
  test.slow()
  await useGraphics(page, 'high')
  await page.setViewportSize(WIDE)
  await installParadox(page)
  await runToParadox(page)
  await page.setViewportSize(PHONE)
  await expect(page.locator('.sheet')).toBeVisible()
  await expect(page.locator('.paradox')).toBeVisible()

  const band = await floorBoxes(page)
  if (!band.sheet || !band.notices || !band.zoom) throw new Error('the floor did not render')
  // FEAT: o chão em ordem: o aviso acima da folha, e o zoom acima do aviso
  expect(band.notices.bottom).toBeLessThanOrEqual(band.sheet.top)
  expect(band.zoom.bottom).toBeLessThanOrEqual(band.notices.top)
  expect(band.reach).toEqual([true, true, true])

  // FEAT: dentro do planeta os cartões saem, o aviso fica
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page.locator('.stage')).toHaveAttribute('data-lens', 'planet')
  await expect(page.locator('.paradox')).toBeVisible()
  await expect(page.locator('.sheet')).toBeHidden()
  const lens = await floorBoxes(page)
  if (!lens.notices || !lens.stage) throw new Error('the notice left the planet')
  expect(lens.notices.height).toBeGreaterThan(0)
  expect(lens.notices.bottom).toBeLessThanOrEqual(lens.stage.bottom + 1)
})

test('the phone keeps its default stage above the sheet', async ({ page }) => {
  // FEAT: sem forçar nada, o celular abre em 3D: é esse palco que tem de ficar acima da folha
  await page.setViewportSize(PHONE)
  await page.goto('/?seed=482913')
  await expect(page.locator('.stage')).toHaveAttribute('data-view', '3d')
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'peek')
  await expect(page.locator('.scene3d__canvas')).toBeVisible()
  const band = await floorBoxes(page)
  if (!band.scene || !band.sheet || !band.stage || !band.zoom) {
    throw new Error('the 3d stage did not render')
  }
  expect(band.scene.bottom).toBeLessThanOrEqual(band.zoom.top + 1)
  expect(band.scene.height).toBeGreaterThan(band.stage.height * 0.5)
  expect(band.zoom.bottom).toBeLessThanOrEqual(band.sheet.top)
  expect(band.reach).toEqual([true, true, true])

  await handleOf(page).click()
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'open')
  await handleOf(page).click()
  await expect(page.locator('.sheet')).toHaveAttribute('data-state', 'hidden')
  await expect.poll(async () => (await floorBoxes(page)).sheet?.height ?? 0).toBeLessThan(120)
  const wide = await floorBoxes(page)
  if (!wide.scene || !wide.sheet) throw new Error('the 3d stage went away')
  // FEAT: escondida a folha, o palco 3D recupera a tela
  expect(wide.scene.bottom).toBeLessThanOrEqual(wide.sheet.top + 1)
  expect(wide.scene.height).toBeGreaterThan(band.scene.height)
})

test('the minimap and the zoom share the floor at tablet width instead of covering it', async ({
  page,
}) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.locator('.sheet')).toBeVisible()
  await expect(page.locator('.minimap')).toBeVisible()
  const band = await floorBoxes(page)
  const map = await page.locator('.minimap').boundingBox()
  if (!band.zoom || !band.sheet || !map) throw new Error('the tablet floor did not render')
  // FEAT: o minimapa no chão, o zoom acima dele, a folha abaixo dos dois
  expect(map.y + map.height).toBeLessThanOrEqual(band.sheet.top)
  expect(band.zoom.bottom).toBeLessThanOrEqual(map.y)
  expect(band.reach).toEqual([true, true, true])
})

test('a short window makes the state panel scroll instead of erasing it', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 640 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Intervene' }).click()
  await expect(page.locator('.panel.allocation')).toBeVisible()
  const squeeze = await page.evaluate(() => {
    const panel = document.querySelector('.panel.state')
    const card = document.querySelector('.card--state')
    const rail = document.querySelector('.hud__left')
    if (!panel || !card || !rail) return null
    const row = panel.querySelector('button.state__row')
    const box = row?.getBoundingClientRect()
    const railBox = rail.getBoundingClientRect()
    return {
      card: card.getBoundingClientRect().height,
      client: panel.clientHeight,
      scroll: panel.scrollHeight,
      railScrolls: rail.scrollHeight > rail.clientHeight,
      rowInside: box ? box.top >= railBox.top - 1 && box.bottom <= railBox.bottom + 1 : false,
    }
  })
  if (!squeeze) throw new Error('the intervene rail did not render')
  // FEAT: o aperto degrada para rolagem: nunca para um cartão de altura zero com o foco preso dentro
  expect(squeeze.client).toBeGreaterThan(24)
  expect(squeeze.scroll).toBeGreaterThan(squeeze.client)
  expect(squeeze.card).toBeGreaterThanOrEqual(112)
  expect(squeeze.rowInside).toBe(true)
})

test('the cards are read before the floor the stage keeps for itself', async ({ page }) => {
  await observe(page)
  const order = await page.evaluate(() => {
    const hud = document.querySelector('.hud')
    const floor = document.querySelector('.stage__floor')
    const stage = document.querySelector('.stage')
    if (!hud || !floor || !stage) return null
    return {
      floorAfterCards: Boolean(
        hud.compareDocumentPosition(floor) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      cardsAfterStage: Boolean(
        stage.compareDocumentPosition(hud) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      zoomOnFloor: document.querySelector('.zoom')?.closest('.stage__floor') !== null,
      mapOnFloor: document.querySelector('.minimap')?.closest('.stage__floor') !== null,
    }
  })
  if (!order) throw new Error('the layers did not render')
  expect(order).toEqual({
    floorAfterCards: true,
    cardsAfterStage: true,
    zoomOnFloor: true,
    mapOnFloor: true,
  })

  // FEAT: antes do primeiro cartão vem o palco em si, e nunca um comando preso ao chão
  await page.locator('.card--state .card__toggle').focus()
  await page.keyboard.press('Shift+Tab')
  const back = await page.evaluate(() => ({
    role: document.activeElement?.getAttribute('role') ?? '',
    floor: document.activeElement?.closest('.stage__floor') !== null,
  }))
  expect(back).toEqual({ role: 'slider', floor: false })

  // FEAT: e depois do último cartão vêm o zoom e o minimapa, que é onde eles estão na tela
  await page.getByRole('button', { name: 'Export file' }).focus()
  await page.keyboard.press('Tab')
  const forward = await page.evaluate(
    () => document.activeElement?.closest('.stage__floor') !== null,
  )
  expect(forward).toBe(true)
})

test('the 3d crossing card clears the cards on a desktop and the sheet on a phone', async ({
  page,
}) => {
  test.slow()
  await page.setViewportSize(WIDE)
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A little' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await expect(page.locator('.scene3d')).toHaveAttribute('data-arcs', '1', { timeout: 10_000 })
  const crossing = page
    .getByRole('list', { name: 'Crossings on the currents' })
    .getByRole('button')
    .first()
  await expect(crossing).toBeAttached({ timeout: 10_000 })
  await crossing.focus()
  await crossing.press('Enter')
  await expect(page.getByRole('dialog')).toBeFocused()

  const audit = () =>
    page.evaluate(() => {
      const card = document.querySelector('.scene3d__card')?.getBoundingClientRect()
      const stage = document.querySelector('.stage')?.getBoundingClientRect()
      if (!card || !stage) return null
      const visible = (node: Element) =>
        getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0
      return {
        buried: [...document.querySelectorAll('.hud .card, .hud .notices > *, .sheet')]
          .filter(visible)
          .filter((node) => {
            const other = node.getBoundingClientRect()
            // FIX: um pixel de arredondamento entre duas bordas encostadas não é sobreposição
            return (
              card.left < other.right - 1 &&
              other.left < card.right - 1 &&
              card.top < other.bottom - 1 &&
              other.top < card.bottom - 1
            )
          })
          .map((node) => node.className),
        inside: card.top >= stage.top - 1 && card.bottom <= stage.bottom + 1,
      }
    })

  const wide = await audit()
  if (!wide) throw new Error('the crossing card did not open')
  expect(wide.buried).toEqual([])
  expect(wide.inside).toBe(true)

  await page.setViewportSize(PHONE)
  await expect(page.locator('.sheet')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeVisible()
  const narrow = await audit()
  if (!narrow) throw new Error('the crossing card left the phone')
  expect(narrow.buried).toEqual([])
  expect(narrow.inside).toBe(true)
})
