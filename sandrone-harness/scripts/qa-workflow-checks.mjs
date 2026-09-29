import assert from 'node:assert/strict'

export async function checkSidebarCollapse(page) {
  const toggle = page.getByRole('button', { name: '切换侧边栏', exact: true })
  const frame = page.locator('[data-sandrone-frame]')
  const initiallyCollapsed = await frame.getAttribute('data-sidebar-collapsed') === 'true'
  if (initiallyCollapsed) await toggle.click()
  await page.waitForFunction(() => document.querySelector('[data-sandrone-frame]')?.getAttribute('data-sidebar-collapsed') !== 'true')
  const sidebar = page.locator('[data-sandrone-sidebar-column]')
  await sidebar.waitFor({ state: 'visible' })
  await toggle.click()
  await sidebar.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => {
    const center = document.querySelector('[data-sandrone-center]')?.getBoundingClientRect()
    const frame = document.querySelector('[data-sandrone-frame]')?.getBoundingClientRect()
    return center && frame && Math.abs(center.left - frame.left) < 1
  })
  assert.equal(await page.locator('[data-side="sidebar"]').count(), 0)
  assert.equal(await page.locator('#root').evaluate(root => root.style.getPropertyValue('--sandrone-sidebar-width')), '0px')
  assert.ok(await toggle.isVisible(), 'titlebar toggle stays available while sidebar is hidden')
  await toggle.focus()
  await toggle.press('Enter')
  await sidebar.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('[data-sandrone-sidebar-column]')
    return sidebar && sidebar.getBoundingClientRect().width > 200
  }, undefined, { timeout: 5000 })
  assert.ok((await sidebar.boundingBox()).width > 200, 'keyboard toggle restores the full sidebar')
  if (initiallyCollapsed) await toggle.click()
}

export async function checkComposerTextAlignment(page) {
  const composer = page.locator('[data-sandrone-composer-input][contenteditable="true"]')
  await composer.fill('')
  await composer.press('Control+Home')
  const placeholder = page.locator('[data-composer-placeholder]')
  await placeholder.waitFor({ state: 'visible' })
  const empty = await composer.evaluate(editor => {
    const hint = editor.parentElement.querySelector('[data-composer-placeholder]')
    const range = document.createRange()
    range.setStart(hint.firstChild, 0)
    range.setEnd(hint.firstChild, 1)
    const inputBounds = editor.getBoundingClientRect()
    const hintBounds = hint.getBoundingClientRect()
    const inputStyle = getComputedStyle(editor)
    const metrics = element => {
      if (!element) return null
      const style = getComputedStyle(element)
      return { font: style.font, padding: style.padding, margin: style.margin, textIndent: style.textIndent }
    }
    const glyph = range.getBoundingClientRect()
    return {
      hint: { x: glyph.x - inputBounds.x, y: glyph.y - inputBounds.y },
      content: { x: parseFloat(inputStyle.paddingLeft), y: parseFloat(inputStyle.paddingTop) },
      placeholderOrigin: { x: hintBounds.x - inputBounds.x, y: hintBounds.y - inputBounds.y },
      editor: metrics(editor), placeholder: metrics(hint),
    }
  })
  assert.ok(Math.abs(empty.placeholderOrigin.x - empty.content.x) <= 1, `empty text origins align horizontally: ${JSON.stringify(empty)}`)
  assert.ok(Math.abs(empty.placeholderOrigin.y - empty.content.y) <= 1, `empty text origins align vertically: ${JSON.stringify(empty)}`)
  assert.equal(empty.editor.font, empty.placeholder.font, `editor and placeholder share font metrics: ${JSON.stringify(empty)}`)
  for (const draft of ['测试 Input', '第一行\n第二行']) {
    await composer.fill(draft)
    await placeholder.waitFor({ state: 'hidden' })
    await composer.press('Control+Home')
    const filled = await composer.evaluate(editor => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      const firstText = walker.nextNode()
      const range = document.createRange()
      range.setStart(firstText, 0)
      range.setEnd(firstText, 1)
      const glyph = range.getBoundingClientRect()
      const bounds = editor.getBoundingClientRect()
      const caret = window.getSelection().getRangeAt(0).getBoundingClientRect()
      return { x: glyph.x - bounds.x, y: glyph.y - bounds.y, caret: caret.toJSON(), glyph: glyph.toJSON() }
    })
    assert.ok(Math.abs(filled.x - empty.hint.x) <= 1, `typed text starts at placeholder: ${JSON.stringify({ empty, filled })}`)
    assert.ok(Math.abs(filled.y - empty.hint.y) <= 1, `typed text shares placeholder baseline: ${JSON.stringify({ empty, filled })}`)
    assert.ok(Math.abs(filled.caret.x - filled.glyph.x) <= 1 && Math.abs(filled.caret.y - filled.glyph.y) <= 1, `caret aligns with typed text: ${JSON.stringify(filled)}`)
  }
  await composer.fill('')
  await placeholder.waitFor({ state: 'visible' })
  return empty
}

export async function checkAttachmentPicker(page) {
  const trigger = page.getByRole('button', { name: '添加附件', exact: true })
  const hits = await trigger.evaluate(button => {
    const bounds = button.getBoundingClientRect()
    return [0.2, 0.5, 0.8].map(fraction => {
      const target = document.elementFromPoint(bounds.left + bounds.width * fraction, bounds.top + bounds.height / 2)
      return { reachable: target === button || button.contains(target), interceptedBy: target?.getAttribute('data-width-handle') }
    })
  })
  assert.ok(hits.every(hit => hit.reachable), `attachment hit targets: ${JSON.stringify(hits)}`)
  const chooserReady = page.waitForEvent('filechooser')
  await trigger.click()
  const chooser = await chooserReady
  await chooser.setFiles([])
}

export async function checkConversationResize(page) {
  const card = page.locator('[data-composer-card]')
  const original = await card.boundingBox()
  for (const [side, travel] of [['left', -24], ['right', -24]]) {
    const handle = await page.locator(`[data-width-handle="${side}"]`).boundingBox()
    assert.ok(handle?.width > 0, `${side} native resize handle is available`)
    const pointer = { x: handle.x + handle.width / 2, y: handle.y + 100 }
    await page.mouse.move(pointer.x, pointer.y)
    await page.mouse.down()
    await page.mouse.move(pointer.x + travel, pointer.y, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(150)
    const resized = await card.boundingBox()
    if (side === 'left') assert.ok(resized.width > original.width + 35, 'composer follows native width expansion')
    else assert.ok(Math.abs(resized.width - original.width) < 3, 'composer follows native width reduction')
    await checkAttachmentPicker(page)
  }
}

export async function checkOpenInAppMenu(page) {
  const control = page.locator('[data-sandrone-open-in-app]')
  const toggle = control.getByRole('button', { name: '选择打开方式', exact: true })
  await toggle.click()
  const menu = page.getByRole('menu')
  await menu.waitFor({ state: 'visible' })
  await page.waitForTimeout(250)
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  const bounds = await menu.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1)
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await toggle.focus()
  await toggle.press('Enter')
  await menu.waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('[role="menu"]')?.contains(document.activeElement), { }, { timeout: 3000 })
  assert.ok(await menu.evaluate(element => element.contains(document.activeElement)), 'native app menu receives keyboard focus')
  const items = menu.getByRole('menuitem')
  if (await items.count() > 1) {
    await page.keyboard.press('ArrowDown')
    assert.ok(await items.nth(1).evaluate(element => element === document.activeElement))
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await page.waitForTimeout(100)
    assert.ok(await items.nth(1).evaluate(element => element === document.activeElement), 'menu repositioning preserves keyboard selection')
  }
  await page.keyboard.press('Escape')
}

export async function checkCommandLauncher(page) {
  const composer = page.locator('[data-sandrone-composer-input][contenteditable="true"]')
  const trigger = page.getByRole('button', { name: '指令', exact: true })
  for (const activation of ['pointer', 'keyboard']) {
    if (activation === 'pointer') await trigger.click()
    else { await trigger.focus(); await trigger.press('Enter') }
    await page.getByRole('listbox').waitFor({ state: 'visible' })
    await page.waitForTimeout(250)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true', `${activation} command launcher stays open`)
    assert.ok(await page.getByRole('option').count() > 0)
    await composer.press('Escape')
    await page.getByRole('listbox').waitFor({ state: 'hidden' })
  }
  await composer.fill('/')
  await page.getByRole('listbox').waitFor({ state: 'visible' })
  await composer.press('Escape')
  await composer.fill('')
}

export async function checkShellGeometry(page) {
  const geometry = await page.evaluate(() => {
    const bounds = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON()
    return {
      topbar: bounds('[data-sandrone-topbar]'),
      center: bounds('[data-sandrone-center]'),
      sidebar: bounds('[data-sandrone-sidebar-header]'),
      toolbar: bounds('[data-sandrone-session-toolbar]:not([aria-hidden="true"])'),
      viewport: { width: innerWidth, height: innerHeight },
      composer: bounds('[data-composer-card]'),
    }
  })
  assert.ok(geometry.topbar && geometry.center && geometry.composer)
  assert.ok(Math.abs(geometry.center.top - geometry.topbar.bottom) < 2, `conversation starts directly below titlebar: ${JSON.stringify(geometry)}`)
  if (geometry.toolbar) assert.ok(Math.abs(geometry.toolbar.top - geometry.topbar.bottom) < 2, 'no empty band above session header')
  assert.ok(geometry.composer.left >= geometry.center.left && geometry.composer.right <= geometry.center.right + 1)
  assert.ok(geometry.composer.bottom <= geometry.viewport.height)
  assert.equal(await page.locator('[data-composer-card] input[type="file"]').count(), 1)
  assert.equal(await page.getByRole('button', { name: '添加附件', exact: true }).count(), 1)
  assert.equal(await page.locator('[data-sidebar-right-expand]').count(), 0)
  return geometry
}

export async function checkSessionViews(page) {
  const tabs = page.locator('[data-sandrone-session-tabs] [role="tab"]')
  await tabs.nth(1).waitFor({ state: 'attached' })
  const labels = (await tabs.allTextContents()).map(label => label.trim())
  assert.ok(labels.includes('对话') && labels.includes('轨迹'), JSON.stringify(labels))
  for (const next of [...labels.slice(1), labels[0]]) {
    await page.getByRole('button', { name: `切换到${next}`, exact: true }).click()
    await page.waitForFunction(expected => document.querySelector('[data-sandrone-session-tabs] [aria-selected="true"]')?.textContent?.trim() === expected, next)
  }
}

export async function checkPermissionSelection(page) {
  const trigger = page.getByRole('button', { name: /^访问模式，当前：/ })
  await trigger.click()
  await page.getByRole('menuitem', { name: '仅可查看', exact: true }).click()
  await page.getByRole('button', { name: '访问模式，当前：仅可查看', exact: true }).waitFor()
  await trigger.click()
  await page.getByRole('menuitem', { name: '工作区内修改', exact: true }).click()
  await page.getByRole('button', { name: '访问模式，当前：工作区内修改', exact: true }).waitFor()
}
