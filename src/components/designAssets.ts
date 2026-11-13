import type { DesignAsset, DesignModel, DesignNode } from '../api/design'

// Scoped capabilities expire on the server after five minutes. Refresh at four
// minutes, measured from request start, so network latency cannot extend TTL.
export const DESIGN_ASSET_FRESH_MS = 4 * 60 * 1000
export const DESIGN_ASSET_RETRY_MS = 15 * 1000

export function designAssetIds(model: DesignModel | null): string[] {
  if (!model) return []
  const ids = new Set<string>()
  const visit = (node: DesignNode) => {
    if (typeof node.props.asset_id === 'string') ids.add(node.props.asset_id)
    for (const child of node.children) visit(child)
  }
  for (const screen of model.screens) visit(screen.root)
  for (const component of model.components) {
    visit(component.root)
    for (const variant of component.variants) {
      if (typeof variant.props.asset_id === 'string') ids.add(variant.props.asset_id)
    }
  }
  for (const override of model.overrides) {
    if (override.property === 'asset_id' && typeof override.value === 'string') ids.add(override.value)
  }
  return [...ids].sort()
}

export class ScopedDesignAssetCache {
  private entries = new Map<string, { asset: DesignAsset; requestedAt: number }>()
  private pending = new Map<string, Promise<DesignAsset>>()

  private key(projectId: string, assetId: string): string {
    return JSON.stringify([projectId, assetId])
  }

  remaining(projectId: string, assetId: string, now: number): number {
    const entry = this.entries.get(this.key(projectId, assetId))
    if (!entry || now < entry.requestedAt) return 0
    return Math.max(0, DESIGN_ASSET_FRESH_MS - (now - entry.requestedAt))
  }

  read(projectId: string, assetId: string, now: number): DesignAsset | undefined {
    return this.remaining(projectId, assetId, now) > 0
      ? this.entries.get(this.key(projectId, assetId))?.asset
      : undefined
  }

  load(
    projectId: string,
    assetId: string,
    fetchAsset: (projectId: string, assetId: string) => Promise<DesignAsset>,
    now: () => number = Date.now
  ): Promise<DesignAsset> {
    const fresh = this.read(projectId, assetId, now())
    if (fresh) return Promise.resolve(fresh)
    const key = this.key(projectId, assetId)
    const pending = this.pending.get(key)
    if (pending) return pending
    const requestedAt = now()
    const request = Promise.resolve()
      .then(() => fetchAsset(projectId, assetId))
      .then(asset => {
        if (asset.id !== assetId || typeof asset.url !== 'string' || !asset.url) {
          throw new Error('Сервер не выдал ссылку для выбранного изображения')
        }
        this.entries.set(key, { asset, requestedAt })
        return asset
      })
      .finally(() => {
        this.pending.delete(key)
      })
    this.pending.set(key, request)
    return request
  }
}
