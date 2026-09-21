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
  await expect(page.getByText('This file is not a WORLDLINE world.')).toBeVisible()
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
  await expect(page.getByText('This file is not a WORLDLINE world.')).toBeVisible()
  await page.getByLabel('Import file').setInputFiles({
    name: 'world.json',
    mimeType: 'application/json',
    buffer: await readFile(path),
  })
  await expect(page.getByText('This file is not a WORLDLINE world.')).toBeHidden()
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
