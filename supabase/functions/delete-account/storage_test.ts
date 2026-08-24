import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { removePrefix, type StorageAdmin, type StorageEntry } from './storage.ts';

Deno.test('removePrefix lists all nested pages before deleting parent entries', async () => {
  const paths = new Set(Array.from({ length: 101 }, (_, index) =>
    `parent/folder-${String(index).padStart(3, '0')}/record.json`));
  const removed: string[][] = [];

  const entriesAt = (prefix: string): StorageEntry[] => {
    const names = new Map<string, StorageEntry>();
    const root = `${prefix}/`;
    for (const path of paths) {
      if (!path.startsWith(root)) continue;
      const name = path.slice(root.length).split('/')[0];
      const isFile = path === `${root}${name}`;
      names.set(name, { name, id: isFile ? path : null });
    }
    return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const admin: StorageAdmin = {
    storage: {
      from: () => ({
        list: async (prefix, { limit, offset }) => ({
          data: entriesAt(prefix).slice(offset, offset + limit), error: null,
        }),
        remove: async (batch) => {
          removed.push(batch);
          for (const path of batch) paths.delete(path);
          return { error: null };
        },
      }),
    },
  };

  await removePrefix(admin, 'record-files', 'parent');

  assertEquals(paths.size, 0);
  assertEquals(removed.flat().length, 101);
});
