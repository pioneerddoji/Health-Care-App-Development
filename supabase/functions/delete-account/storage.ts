export interface StorageEntry {
  name: string;
  id?: string | null;
}

export interface StorageBucket {
  list(prefix: string, options: { limit: number; offset: number }): Promise<{
    data: StorageEntry[] | null;
    error: unknown;
  }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

export interface StorageAdmin {
  storage: { from(bucket: string): StorageBucket };
}

/**
 * Lists the complete tree before deleting anything. Offset pagination is unstable
 * when a recursive deletion removes entries from the parent prefix mid-listing.
 */
const listPrefixPaths = async (admin: StorageAdmin, bucket: string, prefix: string): Promise<string[]> => {
  const files: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error('storage_list_failed');
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) files.push(path);
      else files.push(...await listPrefixPaths(admin, bucket, path));
    }
    if (entries.length < 100) return files;
    offset += entries.length;
  }
};

export const removePrefix = async (admin: StorageAdmin, bucket: string, prefix: string) => {
  const files = await listPrefixPaths(admin, bucket, prefix);
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(files.slice(i, i + 100));
    if (error) throw new Error('storage_remove_failed');
  }
};
