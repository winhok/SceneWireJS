import type { VideoProject } from '@scenewirejs/schema';
export interface AssetResolver {
  resolve(assetId: string): Promise<Blob | ArrayBuffer>;
}
export class StaticAssetResolver implements AssetResolver {
  constructor(
    private readonly assets: VideoProject['assets'],
    private readonly baseUrl: string,
  ) {}
  async resolve(assetId: string): Promise<ArrayBuffer> {
    const asset = this.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    if (/^(blob:|data:)/i.test(asset.src))
      throw new Error(
        'Persist stable asset references, not object URLs or embedded data',
      );
    const url = new URL(asset.src, this.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Unsupported asset URL');
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Asset load failed (${response.status}): ${assetId}`);
    return response.arrayBuffer();
  }
}
export class IndexedDBAssetResolver implements AssetResolver {
  private readonly database: Promise<IDBDatabase>;
  constructor(
    name = 'scenewire-assets',
    private readonly fallback?: AssetResolver,
  ) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('assets');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async put(assetId: string, data: Blob | ArrayBuffer): Promise<void> {
    if (!assetId) throw new Error('Asset ID is required');
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(data, assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async resolve(assetId: string): Promise<Blob | ArrayBuffer> {
    const db = await this.database;
    const value = await new Promise<Blob | ArrayBuffer | undefined>(
      (resolve, reject) => {
        const request = db
          .transaction('assets')
          .objectStore('assets')
          .get(assetId);
        request.onsuccess = () =>
          resolve(request.result as Blob | ArrayBuffer | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    if (value !== undefined) return value;
    if (this.fallback) return this.fallback.resolve(assetId);
    throw new Error(`Missing stored asset: ${assetId}`);
  }
  async close(): Promise<void> {
    (await this.database).close();
  }
}
export async function assetBytes(
  resolver: AssetResolver,
  id: string,
): Promise<ArrayBuffer> {
  const data = await resolver.resolve(id);
  return data instanceof ArrayBuffer ? data.slice(0) : data.arrayBuffer();
}
