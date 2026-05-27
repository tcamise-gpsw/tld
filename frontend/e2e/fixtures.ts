import { expect, test as base } from '@playwright/test'
import { prepareStorage } from './helpers/vieweditor'

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const styleText = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0.001s !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `
      const install = () => {
        const style = document.createElement('style')
        style.dataset.tldE2e = 'disable-animations'
        style.textContent = styleText
        document.head.appendChild(style)
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true })
      } else {
        install()
      }
    })
    await prepareStorage(page)
    await expect.poll(async () => {
      const response = await page.request.get('/api/ready')
      return response.ok()
    }).toBe(true)
    await use(page)
  },
})

export { expect }
