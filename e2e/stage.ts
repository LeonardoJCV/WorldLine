import type { Page } from '@playwright/test'

export async function useGraphics(page: Page, setting: 'auto' | 'low' | 'high' | 'ultra' | '2d') {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('worldline.graphics', value)
    } catch {
      // sem armazenamento: o teste falha adiante
    }
  }, setting)
}
