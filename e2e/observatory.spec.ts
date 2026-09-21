import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=482913')
})

test('shows the seed from the URL and starts at year zero', async ({ page }) => {
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByTestId('year')).toHaveText('0000')
})

test('plays and pauses time', async ({ page }) => {
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByTestId('year')).not.toHaveText('0000')
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  const paused = await page.getByTestId('year').textContent()
  await page.waitForTimeout(500)
  await expect(page.getByTestId('year')).toHaveText(paused ?? '')
})

test('advances one year at a time', async ({ page }) => {
  const step = page.getByRole('button', { name: 'Advance one year' })
  await step.click()
  await step.click()
  await expect(page.getByTestId('year')).toHaveText('0002')
})

test('switches language and remembers the choice', async ({ page }) => {
  await page.getByRole('button', { name: 'Português' }).click()
  await expect(page.getByRole('button', { name: 'Reproduzir' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reproduzir' })).toBeVisible()
})

test('runs without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.reload()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(800)
  expect(errors).toEqual([])
})

test('moves through time with the keyboard', async ({ page }) => {
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 12; i++) await step.click()
  await expect(page.getByTestId('year')).toHaveText('0012')
  const current = page.getByRole('slider')
  await current.focus()
  await current.press('ArrowLeft')
  await expect(page.getByTestId('year')).toHaveText('0011')
  await current.press('Shift+ArrowLeft')
  await expect(page.getByTestId('year')).toHaveText('0001')
  await current.press('End')
  await expect(page.getByTestId('year')).toHaveText('0012')
  await expect(page.getByRole('button', { name: 'Return to the present' })).toHaveCount(0)
})

test('scrubs the past with the pointer', async ({ page }) => {
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const current = page.getByRole('slider', { name: /Worldline history/ })
  const box = await current.boundingBox()
  if (!box) throw new Error('current is not visible')
  await page.mouse.click(box.x + 40, box.y + box.height / 2)
  await expect(page.getByRole('button', { name: 'Return to the present' })).toBeVisible()
  const year = Number(await page.getByTestId('year').textContent())
  const present = Number(await current.getAttribute('aria-valuemax'))
  expect(year).toBeLessThan(present / 2)
})

test('lists every variable in the legend', async ({ page }) => {
  const legend = page.getByRole('list', { name: 'Variables' })
  for (const name of [
    'Population',
    'Food',
    'Energy',
    'Technology',
    'Economy',
    'Environment',
    'Stability',
  ]) {
    await expect(legend.getByText(name)).toBeVisible()
  }
})

test('renders the planet with WebGL', async ({ page }) => {
  await expect(page.getByRole('img', { name: /The world in year/ })).toHaveAttribute(
    'data-renderer',
    'webgl',
  )
})

test('falls back to a 2D planet without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) {
      if (type.startsWith('webgl')) return null
      return original.call(this, type as '2d', options as CanvasRenderingContext2DSettings)
    } as typeof original
  })
  await page.reload()
  await expect(page.getByRole('img', { name: /The world in year/ })).toHaveAttribute(
    'data-renderer',
    'fallback',
  )
})

test('shows the world at the observed year', async ({ page }) => {
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 5; i++) await step.click()
  await expect(page.getByTestId('year')).toHaveText('0005')
  await page.getByRole('slider').focus()
  await page.getByRole('slider').press('Home')
  await expect(page.getByRole('img', { name: 'The world in year 0000' })).toBeVisible()
})

test('shows the state at the observed year with yearly changes', async ({ page }) => {
  const step = page.getByRole('button', { name: 'Advance one year' })
  await step.click()
  await step.click()
  await expect(page.getByRole('heading', { name: 'State in year 0002' })).toBeVisible()
  await expect(page.locator('.state__change').first()).not.toBeEmpty()
})

test('lists events and jumps to the selected one', async ({ page }) => {
  await page.getByRole('button', { name: '×64' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  const item = page
    .getByRole('region', { name: 'Events' })
    .getByRole('button', { name: /Golden age/ })
    .last()
  await expect(item).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  const year = (await item.locator('.events__year').textContent()) ?? ''
  await item.click()
  await expect(page.getByTestId('year')).toHaveText(year)
  await expect(item).toHaveAttribute('aria-current', 'true')
})

test('asks for a selection before tracing causes', async ({ page }) => {
  await expect(page.getByText('Select an event to trace its causes.')).toBeVisible()
})

test('traces the causes of a selected event', async ({ page }) => {
  await page.getByRole('button', { name: '×64' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  const item = page
    .getByRole('region', { name: 'Events' })
    .getByRole('button', { name: /Golden age/ })
    .last()
  await expect(item).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  await item.click()
  const chain = page.getByRole('group', { name: 'Causes of Golden age' })
  await expect(chain.getByText('Stability')).toBeVisible()
  await expect(chain.getByText('Food security')).toBeVisible()
})

test('applies a decision in intervene mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Intervene' }).click()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await expect(agriculture).toHaveValue('45')
  const values = await Promise.all(
    ['Agriculture', 'Industry', 'Research', 'Conservation'].map(async (name) =>
      Number(await page.getByRole('slider', { name: new RegExp(name) }).inputValue()),
    ),
  )
  expect(values.reduce((sum, value) => sum + value, 0)).toBe(100)
  const apply = page.getByRole('button', { name: 'Apply decision' })
  await apply.click()
  await expect(apply).toBeDisabled()
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(agriculture).toHaveValue('45')
})

test('zooms into a window of history and back', async ({ page }) => {
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const minimap = page.getByRole('slider', { name: /Whole history/ })
  await expect(minimap).toHaveAttribute('aria-valuetext', /^Showing years 0000 to/)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(minimap).not.toHaveAttribute('aria-valuetext', /^Showing years 0000 to/)
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(minimap).toHaveAttribute('aria-valuetext', /^Showing years 0000 to/)
})

test('moves the window with the minimap keyboard', async ({ page }) => {
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  await zoomIn.click()
  await zoomIn.click()
  const minimap = page.getByRole('slider', { name: /Whole history/ })
  await minimap.focus()
  await minimap.press('Home')
  await expect(minimap).toHaveAttribute('aria-valuetext', /^Showing years 0000 to/)
  const present = await page.getByTestId('year').textContent()
  await minimap.press('End')
  await expect(minimap).toHaveAttribute('aria-valuetext', new RegExp(`to ${present ?? ''}$`))
})
