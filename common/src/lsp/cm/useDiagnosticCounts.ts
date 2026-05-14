import { useEffect, useState } from 'react'
import type { Diagnostic } from 'vscode-languageserver-types'

import { type LspClient } from '../LspClient'
import { pathFromFileUri } from '../uriResolver'

export type DiagnosticCounts = {
    errors: number
    warnings: number
    infos: number
    hints: number
    total: number
}

const EMPTY: DiagnosticCounts = { errors: 0, warnings: 0, infos: 0, hints: 0, total: 0 }

function tally(diags: readonly Diagnostic[]): DiagnosticCounts {
    let errors = 0
    let warnings = 0
    let infos = 0
    let hints = 0
    for (const d of diags) {
        switch (d.severity ?? 1) {
            case 1:
                errors++
                break
            case 2:
                warnings++
                break
            case 3:
                infos++
                break
            case 4:
                hints++
                break
        }
    }
    return { errors, warnings, infos, hints, total: errors + warnings + infos + hints }
}

/** Subscribe to the LSP's diagnostic stream for `uri` and return the running
 *  counts by severity. Returns zeros when `client` or `uri` is missing. */
export function useDiagnosticCounts(
    client: LspClient | null | undefined,
    uri: string | null | undefined,
): DiagnosticCounts {
    const [counts, setCounts] = useState<DiagnosticCounts>(EMPTY)

    useEffect(() => {
        if (!client || !uri) {
            setCounts(EMPTY)
            return
        }
        setCounts(tally(client.getDiagnostics(uri)))
        return client.onDiagnostics((u, diags) => {
            if (u !== uri) return
            setCounts(tally(diags))
        })
    }, [client, uri])

    return counts
}

const EMPTY_PATH_SET: ReadonlySet<string> = new Set()

/** Subscribe to the LSP's global diagnostic stream and return the set of
 *  project-relative paths that currently hold at least one diagnostic of
 *  `minSeverity` or worse (severity 1 = error, 2 = warning, …). Used by the
 *  file browser to decorate files with errors. */
export function useDiagnosticPaths(
    client: LspClient | null | undefined,
    minSeverity: 1 | 2 | 3 | 4 = 1,
): ReadonlySet<string> {
    const [paths, setPaths] = useState<ReadonlySet<string>>(EMPTY_PATH_SET)

    useEffect(() => {
        if (!client) {
            setPaths(EMPTY_PATH_SET)
            return
        }
        const recompute = () => {
            const next = new Set<string>()
            for (const [uri, diags] of client.getAllDiagnostics()) {
                if (!diags.some((d) => (d.severity ?? 1) <= minSeverity)) continue
                const raw = pathFromFileUri(uri)
                const projectPath = raw.startsWith('/') ? raw.slice(1) : raw
                if (projectPath) next.add(projectPath)
            }
            setPaths(next)
        }
        recompute()
        return client.onDiagnostics(recompute, { replay: false })
    }, [client, minSeverity])

    return paths
}
