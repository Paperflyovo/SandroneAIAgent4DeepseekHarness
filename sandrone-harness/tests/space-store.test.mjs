import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import store from '../apps/desktop/lib/space-store.cjs'

const { createSpace, renameSpace, listSpaces, listDocuments, listFolders, listResources, searchSpaces, readMarkdown, writeMarkdown, createMarkdown, createDirectory, renameMarkdown, deleteMarkdown, restoreMarkdown, deleteSpace, copyResource, readResource, renameResource, deleteResource, migrateSpaceRoot } = store

test('space store creates the documented md and res layout and persists markdown atomically', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const space = createSpace(root, '我的想法')
  assert.equal(space.name, '我的想法')
  assert.deepEqual(listSpaces(root).map(item => item.name), ['我的想法'])
  const created = createMarkdown(root, space.id, 'daily/2026-09-26.md')
  assert.match(created.content, /新文档/)
  const saved = writeMarkdown(root, space.id, 'daily/2026-09-26.md', '# 今天\n\n记录一下。')
  assert.equal(saved.content, '# 今天\n\n记录一下。')
  assert.deepEqual(listDocuments(root, space.id), ['daily/2026-09-26.md'])
  assert.equal(readMarkdown(root, space.id, 'daily/2026-09-26.md').content, '# 今天\n\n记录一下。')
  assert.equal(await readFile(join(root, space.id, 'space.json'), 'utf8').then(value => value.includes('我的想法')), true)
  const source = join(root, 'image.png')
  await writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const resource = copyResource(root, space.id, source)
  assert.equal(resource.path, 'image.png')
  assert.deepEqual([...readResource(root, space.id, resource.path).bytes], [0x89, 0x50, 0x4e, 0x47])
  assert.deepEqual(listResources(root, space.id).map(item => item.path), ['image.png'])
  assert.deepEqual(searchSpaces(root, '记录一下').map(item => `${item.spaceName}/${item.path}`), ['我的想法/daily/2026-09-26.md'])
  const renamed = renameMarkdown(root, space.id, 'daily/2026-09-26.md', 'daily/today.md')
  assert.equal(renamed.path, 'daily/today.md')
  assert.deepEqual(listDocuments(root, space.id), ['daily/today.md'])
})

test('space store rejects traversal for documents and deletes only the selected space', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-safe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = createSpace(root, 'One')
  const second = createSpace(root, 'Two')
  assert.throws(() => writeMarkdown(root, first.id, '../escape.md', 'bad'), /escapes|invalid/i)
  assert.throws(() => createMarkdown(root, first.id, 'C:\\escape.md'), /relative|escapes|invalid/i)
  deleteMarkdown(root, first.id, 'missing.md')
  deleteSpace(root, first.id)
  assert.deepEqual(listSpaces(root).map(item => item.id), [second.id])
})

test('space metadata corruption is reported instead of silently overwriting user data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-corrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const space = createSpace(root, 'Corruptible')
  await writeFile(join(root, space.id, 'space.json'), '{broken', 'utf8')
  assert.throws(() => listSpaces(root), /metadata is invalid/i)
  await mkdir(join(root, 'outside'), { recursive: true })
})

test('space document deletion can be restored from the local trash', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-trash-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const space = createSpace(root, 'Trash')
  writeMarkdown(root, space.id, 'notes.md', '# 保留\n')
  const removed = deleteMarkdown(root, space.id, 'notes.md')
  assert.match(removed.trashId, /^\d+-[a-z0-9]{8}$/)
  assert.deepEqual(listDocuments(root, space.id), [])
  const restored = restoreMarkdown(root, space.id, 'notes.md', removed.trashId)
  assert.equal(restored.content, '# 保留\n')
  assert.deepEqual(listDocuments(root, space.id), ['notes.md'])
})

test('space supports folders, display-name changes, and resource management', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-management-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const space = createSpace(root, '原始名称')
  createDirectory(root, space.id, '项目/素材')
  assert.deepEqual(listFolders(root, space.id), ['项目', '项目/素材'])
  const renamedSpace = renameSpace(root, space.id, '新名称')
  assert.equal(renamedSpace.name, '新名称')
  assert.equal(listSpaces(root)[0].name, '新名称')
  const source = join(root, 'resource.txt')
  await writeFile(source, 'resource', 'utf8')
  copyResource(root, space.id, source)
  writeMarkdown(root, space.id, 'notes.md', '![资源](res/resource.txt)\n')
  renameResource(root, space.id, 'resource.txt', '项目/素材/renamed.txt')
  assert.deepEqual(listResources(root, space.id).map(item => item.path), ['项目/素材/renamed.txt'])
  assert.match(readMarkdown(root, space.id, 'notes.md').content, /res\/项目\/素材\/renamed\.txt/)
  deleteResource(root, space.id, '项目/素材/renamed.txt')
  assert.deepEqual(listResources(root, space.id), [])
})

test('a hidden entry in the document folder does not truncate the folder list', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-hidden-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const space = createSpace(root, 'Hidden')
  createDirectory(root, space.id, 'alpha')
  createDirectory(root, space.id, 'zeta')
  assert.deepEqual(listFolders(root, space.id), ['alpha', 'zeta'])

  // An Agent running `git init` inside md/ is an ordinary event; it must not
  // make the whole folder tree disappear from the space panel.
  await mkdir(join(root, space.id, 'md', '.git'), { recursive: true })
  assert.deepEqual(listFolders(root, space.id), ['alpha', 'zeta'])

  createDirectory(root, space.id, 'beta')
  assert.deepEqual(listFolders(root, space.id), ['alpha', 'beta', 'zeta'])
})

test('resource import refuses sources inside application data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-space-guard-'))
  const appData = await mkdtemp(join(tmpdir(), 'sandrone-appdata-'))
  const elsewhere = await mkdtemp(join(tmpdir(), 'sandrone-elsewhere-'))
  t.after(() => Promise.all([root, appData, elsewhere].map(dir => rm(dir, { recursive: true, force: true }))))

  const space = createSpace(root, 'Guard')
  const secret = join(appData, '.credentials.yaml')
  await writeFile(secret, 'apiKey: sk-secret\n', 'utf8')
  const options = { protectedRoots: [appData] }

  assert.throws(() => copyResource(root, space.id, secret, options), /application data/i)
  assert.deepEqual(listResources(root, space.id), [])

  // A link that resolves into the protected root must not slip past either.
  const link = join(elsewhere, 'link.yaml')
  let linked = false
  try { await symlink(secret, link, 'file'); linked = true } catch {}
  if (linked) assert.throws(() => copyResource(root, space.id, link, options), /application data/i)

  // A file the user keeps elsewhere still imports, so drag-and-drop is intact.
  const ordinary = join(elsewhere, 'photo.png')
  await writeFile(ordinary, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.equal(copyResource(root, space.id, ordinary, options).path, 'photo.png')
})

test('space migration copies previous notes once and never deletes the source', async t => {
  const previous = await mkdtemp(join(tmpdir(), 'sandrone-space-previous-'))
  const target = await mkdtemp(join(tmpdir(), 'sandrone-space-target-'))
  t.after(() => Promise.all([previous, target].map(dir => rm(dir, { recursive: true, force: true }))))

  const space = createSpace(previous, '旧笔记')
  writeMarkdown(previous, space.id, 'note.md', '# 保留我\n')

  const first = migrateSpaceRoot(previous, target)
  assert.equal(first.migrated, true)
  assert.equal(first.spaces, 1)
  assert.deepEqual(listSpaces(target).map(item => item.name), ['旧笔记'])
  assert.equal(readMarkdown(target, space.id, 'note.md').content, '# 保留我\n')
  // The source stays readable so a downgrade can still find the notes.
  assert.equal(readMarkdown(previous, space.id, 'note.md').content, '# 保留我\n')

  const second = migrateSpaceRoot(previous, target)
  assert.equal(second.migrated, false)
  assert.equal(second.reason, 'target-not-empty')
  assert.equal(migrateSpaceRoot(target, target).reason, 'same-root')
})

test('space migration is a no-op when the previous location has nothing', async t => {
  const empty = await mkdtemp(join(tmpdir(), 'sandrone-space-none-'))
  const target = await mkdtemp(join(tmpdir(), 'sandrone-space-fresh-'))
  t.after(() => Promise.all([empty, target].map(dir => rm(dir, { recursive: true, force: true }))))

  assert.deepEqual(
    migrateSpaceRoot(join(empty, 'missing'), target),
    { migrated: false, reason: 'nothing-to-migrate', spaces: 0 },
  )
})
