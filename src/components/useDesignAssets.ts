import { useEffect, useMemo, useRef, useState } from 'react'
import { designApi, type DesignAsset, type DesignModel } from '../api/design'
import { DESIGN_ASSET_RETRY_MS, designAssetIds, ScopedDesignAssetCache } from './designAssets'

interface AssetState {
  projectId: string | null
  ids: string
  assets: DesignAsset[]
  error: string
}

// Only the effective preview model determines asset scope. Refreshing a
// capability never reloads documents, rewrites patches or starts model calls.
export function useDesignAssets(
  projectId: string | null,
  model: DesignModel | null,
  selection: string,
  revision: number | null
): { assets: DesignAsset[]; error: string } {
  const cache = useRef(new ScopedDesignAssetCache())
  const ids = useMemo(() => JSON.stringify(designAssetIds(model)), [model])
  const [state, setState] = useState<AssetState>({ projectId: null, ids: '', assets: [], error: '' })

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const assetIds = JSON.parse(ids) as string[]
    const publish = (assets: DesignAsset[], error: string) => {
      if (!live) return
      setState(previous => {
        const next = { projectId, ids, assets, error }
        return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      })
    }
    if (!projectId || !assetIds.length) {
      publish([], '')
      return () => {
        live = false
      }
    }
    const scopedProject = projectId
    const snapshot = () =>
      assetIds
        .map(id => cache.current.read(scopedProject, id, Date.now()))
        .filter((asset): asset is DesignAsset => !!asset)
    const refresh = async () => {
      publish(snapshot(), '')
      const results = await Promise.allSettled(
        assetIds.map(id => cache.current.load(scopedProject, id, designApi.readAsset))
      )
      if (!live) return
      const failed = results.find(result => result.status === 'rejected')
      const error =
        failed?.status === 'rejected'
          ? 'Не удалось обновить ссылку на изображение. Доступ проверяется сервером, повтор будет позже.'
          : ''
      publish(snapshot(), error)
      const now = Date.now()
      const delay = Math.min(
        ...assetIds.map(id => cache.current.remaining(scopedProject, id, now) || DESIGN_ASSET_RETRY_MS)
      )
      timer = setTimeout(
        () => {
          void refresh()
        },
        Math.max(100, delay)
      )
    }
    void refresh()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [projectId, ids, model, selection, revision])

  // Never leak a previous project's capability while the new scope is loading.
  return state.projectId === projectId && state.ids === ids
    ? {
        assets: state.assets.filter(
          asset => cache.current.read(projectId!, asset.id, Date.now())?.url === asset.url
        ),
        error: state.error
      }
    : { assets: [], error: '' }
}
