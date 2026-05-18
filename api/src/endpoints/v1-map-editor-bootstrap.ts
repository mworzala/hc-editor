import { queryOptions, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { z } from 'zod'

import type { HCClient } from '../client'
import { mapEditorBootstrapPath } from '../path'
import { useHCClient } from '../provider'

export const MapFileSchema = z.object({
    path: z.string(),
    contentType: z.string(),
    size: z.int(),
    /** Hex SHA-256 of the stored bytes. Doubles as the strong ETag for
     *  conditional file requests (see v1-map-files-*). */
    hash: z.string(),
})
export type MapFile = z.infer<typeof MapFileSchema>

export const MapInfoSchema = z.object({
    id: z.string(),
    name: z.string(),
    owner: z.string(),
})
export type MapInfo = z.infer<typeof MapInfoSchema>

export const MapEditorBootstrapSchema = z.object({
    map: MapInfoSchema,
    files: z.array(MapFileSchema),
})
export type MapEditorBootstrap = z.infer<typeof MapEditorBootstrapSchema>

// ---- Endpoint ----
// One call to initialize the editor: map metadata + the full file listing.
// Replaces the old GET /projects/{id}. Requires a session (401 unauth, 404
// unknown map, 403 not the owner).

export const v1MapEditorBootstrap = (
    client: HCClient,
    mapId: string,
): Promise<MapEditorBootstrap> =>
    client.request('GET', mapEditorBootstrapPath(mapId), {
        response: MapEditorBootstrapSchema,
    })

// ---- Query key ----
// Pass no args for a prefix match (matches all bootstrap queries).

export const v1MapEditorBootstrapKey = (mapId?: string) =>
    ['v1', 'map', 'editor', 'bootstrap', ...(mapId === undefined ? [] : [mapId])] as const

// ---- Query options ----

export const v1MapEditorBootstrapOptions = (client: HCClient, mapId: string) =>
    queryOptions({
        queryKey: v1MapEditorBootstrapKey(mapId),
        queryFn: () => v1MapEditorBootstrap(client, mapId),
    })

// ---- Hook ----

export type UseV1MapEditorBootstrapOptions = { client?: HCClient } & Partial<
    Omit<
        UseQueryOptions<
            MapEditorBootstrap,
            Error,
            MapEditorBootstrap,
            ReturnType<typeof v1MapEditorBootstrapKey>
        >,
        'queryKey' | 'queryFn'
    >
>

export const useV1MapEditorBootstrap = (mapId: string, opts?: UseV1MapEditorBootstrapOptions) => {
    const client = useHCClient(opts?.client)
    const { client: _client, ...rest } = opts ?? {}
    return useQuery({ ...v1MapEditorBootstrapOptions(client, mapId), ...rest })
}
