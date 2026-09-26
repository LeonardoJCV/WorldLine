import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

async function worldAtYearThree(page: import('@playwright/test').Page) {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 3; i++) await step.click()
  await expect(page.getByTestId('year')).toHaveText('0003')
}

test('saves a world and reopens it from genesis', async ({ page }) => {
  await worldAtYearThree(page)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved to this browser.')).toBeVisible()
  await page.getByRole('button', { name: 'New world' }).click()
  const item = page.getByRole('listitem').filter({ hasText: 'World 482913, year 0003' })
  await item.getByRole('button', { name: 'Open' }).click()
  await expect(page.getByTestId('year')).toHaveText('0003')
})

test('exports a world file and imports it back', async ({ page }) => {
  await worldAtYearThree(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export file' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('worldline-482913-0003.json')
  const path = await file.path()
  await page.getByRole('button', { name: 'New world' }).click()
  await page.getByLabel('Import file').setInputFiles({
    name: 'world.json',
    mimeType: 'application/json',
    buffer: await readFile(path),
  })
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByTestId('year')).toHaveText('0003')
})

test('refuses files that are not worlds', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  })
  await expect(
    page.getByText('This file is not a WORLDLINE world, or it comes from an earlier model.'),
  ).toBeVisible()
})

test('clears the import error once a valid file is imported', async ({ page }) => {
  await worldAtYearThree(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export file' }).click()
  const file = await download
  const path = await file.path()
  await page.getByRole('button', { name: 'New world' }).click()
  await page.getByLabel('Import file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  })
  await expect(
    page.getByText('This file is not a WORLDLINE world, or it comes from an earlier model.'),
  ).toBeVisible()
  await page.getByLabel('Import file').setInputFiles({
    name: 'world.json',
    mimeType: 'application/json',
    buffer: await readFile(path),
  })
  await expect(
    page.getByText('This file is not a WORLDLINE world, or it comes from an earlier model.'),
  ).toBeHidden()
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByTestId('year')).toHaveText('0003')
})

test('copies the world link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await worldAtYearThree(page)
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Link copied.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url())
})

// FEAT: o registro que um modelo anterior gravou, escrito direto no banco como ele ficou lá
async function storeEarlierModelWorld(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('worldline', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('worlds', { keyPath: 'id' })
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('worlds', 'readwrite')
          transaction.objectStore('worlds').put({
            id: 'before-the-works',
            name: 'Before the works',
            savedAt: Date.now(),
            link: {
              version: 2,
              seed: 482913,
              tick: 320,
              decisions: [
                {
                  tick: 100,
                  allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 },
                },
              ],
              crossings: [],
              branches: [],
            },
          })
          transaction.onerror = () => reject(transaction.error)
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )
}

// FIX: o registro de modelo anterior era filtrado da lista e ficava no banco sem quem o apagasse
test('keeps a world saved by an earlier model listed, and lets it be deleted', async ({ page }) => {
  await page.goto('/')
  await storeEarlierModelWorld(page)
  await page.reload()
  const item = page.getByRole('listitem').filter({ hasText: 'Before the works' })
  await expect(item).toBeVisible()
  await expect(item.getByText('Saved by an earlier model; it no longer reopens.')).toBeVisible()
  await expect(item.getByRole('button', { name: 'Open' })).toHaveCount(0)
  await item.getByRole('button', { name: 'Delete' }).click()
  await expect(item).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: 'Before the works' })).toHaveCount(0)
})
