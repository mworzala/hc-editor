import { ScrollArea } from '@hollowcube/design-system'

import {
    findDocNode,
    findMember,
    memberSignature,
    methodSignature,
    propertySignature,
    type EngineApiDoc,
    type EngineApiExport,
    type EngineApiMember,
    type EngineApiModule,
} from '../../engine-api'
import { useEngineApi } from '../../model'
import { type EditorDefinition } from '../registry'
import { DOCS_EDITOR_KIND } from './docs-kind'

// Read-only documentation editor for synthetic LSP-known modules: engine
// library modules (e.g. `@mapmaker/store`) and the engine globals declared in
// the definition file (`Text`, `runtime`). Opened by go-to-def and the docs
// search source; keyed by `moduleId` so repeat opens reuse the tab. v1 is a
// minimal structured view straight off the bundle JSON — richer rendering
// (formatted types, cross-links, markdown) is a follow-up.

// Re-export for existing import sites (the canonical home is `./docs-kind`).
export { DOCS_EDITOR_KIND }

export type DocsEditorPayload = {
    /** Stable id: a library key (`@mapmaker/store`) or the definition file's
     *  alias (`global.d.luau`). */
    moduleId: string
    /** Open origin so the renderer knows whether `moduleId` is a library or
     *  the globals definition file. */
    kind?: 'library' | 'definition-file'
    /** The engine symbol that was referenced (go-to-def / search). `null`
     *  when the module itself was the target (e.g. clicking the `require`). */
    symbol?: string | null
}

function parsePayload(raw: unknown): DocsEditorPayload {
    if (!raw || typeof raw !== 'object') return { moduleId: '' }
    const obj = raw as Record<string, unknown>
    const out: DocsEditorPayload = {
        moduleId: typeof obj.moduleId === 'string' ? obj.moduleId : '',
    }
    if (obj.kind === 'library' || obj.kind === 'definition-file') out.kind = obj.kind
    if (typeof obj.symbol === 'string') out.symbol = obj.symbol
    else if (obj.symbol === null) out.symbol = null
    return out
}

type Resolution =
    | { kind: 'module'; node: EngineApiModule; member?: EngineApiMember }
    | { kind: 'globals-index'; globals: EngineApiModule[] }
    | { kind: 'missing'; moduleId: string }

function resolveDocs(doc: EngineApiDoc, payload: DocsEditorPayload): Resolution {
    if (payload.kind === 'definition-file') {
        // `moduleId` is the def-file alias, not a global. Map the referenced
        // symbol to a global (by name, or as a member of one).
        if (payload.symbol) {
            const byName = doc.globals.find((g) => g.moduleName === payload.symbol)
            if (byName) return { kind: 'module', node: byName }
            for (const g of doc.globals) {
                const member = findMember(g, payload.symbol)
                if (member) return { kind: 'module', node: g, member }
            }
        }
        return { kind: 'globals-index', globals: doc.globals }
    }

    const node = findDocNode(doc, payload.moduleId)
    if (!node) return { kind: 'missing', moduleId: payload.moduleId }
    const member = payload.symbol ? findMember(node, payload.symbol) : undefined
    return { kind: 'module', node, member }
}

function Description({ text }: { text?: string }) {
    if (!text) return null
    return <p className='text-foreground/80 max-w-prose text-sm whitespace-pre-wrap'>{text}</p>
}

function SignatureRow({ signature, description }: { signature: string; description?: string }) {
    return (
        <div className='border-border/60 flex flex-col gap-1 border-b py-2 last:border-b-0'>
            <code className='text-foreground font-mono text-[0.8125rem]'>{signature}</code>
            {description ? (
                <p className='text-muted-foreground max-w-prose text-xs whitespace-pre-wrap'>
                    {description}
                </p>
            ) : null}
        </div>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className='flex flex-col gap-1'>
            <h2 className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
                {title}
            </h2>
            <div className='flex flex-col'>{children}</div>
        </section>
    )
}

function ModuleBody({ node }: { node: EngineApiModule }) {
    return (
        <>
            {node.staticMethods && node.staticMethods.length > 0 ? (
                <Section title='Methods'>
                    {node.staticMethods.map((m) => (
                        <SignatureRow
                            key={m.name}
                            signature={methodSignature(m)}
                            description={m.description}
                        />
                    ))}
                </Section>
            ) : null}

            {node.staticProperties && node.staticProperties.length > 0 ? (
                <Section title='Properties'>
                    {node.staticProperties.map((p) => (
                        <SignatureRow
                            key={p.name}
                            signature={propertySignature(p)}
                            description={p.description ?? p.getter?.description}
                        />
                    ))}
                </Section>
            ) : null}

            {(node.exports ?? []).map((exp) => (
                <ExportBlock key={exp.name} exp={exp} />
            ))}
        </>
    )
}

function ExportBlock({ exp }: { exp: EngineApiExport }) {
    return (
        <Section title={`type ${exp.name}`}>
            <Description text={exp.description} />
            {(exp.methods ?? []).map((m) => (
                <SignatureRow
                    key={m.name}
                    signature={methodSignature(m)}
                    description={m.description}
                />
            ))}
            {(exp.properties ?? []).map((p) => (
                <SignatureRow
                    key={p.name}
                    signature={propertySignature(p)}
                    description={p.description ?? p.getter?.description}
                />
            ))}
            {(exp.metaMethods ?? []).map((mm) => (
                <SignatureRow key={mm.meta} signature={mm.meta} description={mm.description} />
            ))}
        </Section>
    )
}

function FocusedMember({ member }: { member: EngineApiMember }) {
    const description =
        member.kind === 'method'
            ? member.method.description
            : member.kind === 'property'
              ? (member.property.description ?? member.property.getter?.description)
              : member.export.description
    return (
        <div className='bg-muted/40 ring-border flex flex-col gap-1.5 rounded-lg p-4 ring-1'>
            <p className='text-muted-foreground text-[0.65rem] tracking-wide uppercase'>
                Focused symbol
            </p>
            <code className='text-foreground font-mono text-sm'>{memberSignature(member)}</code>
            {description ? (
                <p className='text-foreground/80 max-w-prose text-sm whitespace-pre-wrap'>
                    {description}
                </p>
            ) : null}
        </div>
    )
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className='flex h-full flex-col items-center justify-center gap-2 p-6 text-center'>
            {children}
        </div>
    )
}

function DocsTab({ payload }: { payload: DocsEditorPayload }) {
    const engine = useEngineApi()

    if (engine.status === 'loading') {
        return (
            <Centered>
                <p className='text-muted-foreground text-sm'>Loading documentation…</p>
            </Centered>
        )
    }
    if (engine.status === 'error') {
        return (
            <Centered>
                <p className='text-destructive text-sm'>Failed to load engine API documentation.</p>
                <p className='text-muted-foreground max-w-md text-xs'>{engine.error.message}</p>
            </Centered>
        )
    }

    const resolution = resolveDocs(engine.bundle.doc, payload)

    if (resolution.kind === 'missing') {
        return (
            <Centered>
                <h1 className='font-mono text-lg'>{resolution.moduleId || 'Documentation'}</h1>
                <p className='text-muted-foreground max-w-md text-sm'>
                    No documentation available for this module.
                </p>
            </Centered>
        )
    }

    if (resolution.kind === 'globals-index') {
        return (
            <ScrollArea className='h-full'>
                <div className='mx-auto flex max-w-3xl flex-col gap-4 p-6'>
                    <p className='text-muted-foreground text-xs tracking-wide uppercase'>
                        Engine globals
                    </p>
                    {resolution.globals.map((g) => (
                        <div key={g.moduleName} className='flex flex-col gap-1'>
                            <h2 className='font-mono text-base'>{g.moduleName}</h2>
                            <Description text={g.description} />
                        </div>
                    ))}
                </div>
            </ScrollArea>
        )
    }

    const { node, member } = resolution
    const isGlobal = engine.bundle.doc.globals.some((g) => g === node)
    const subtitle = isGlobal ? 'Engine global' : 'Engine library module'

    return (
        <ScrollArea className='h-full'>
            <div className='mx-auto flex max-w-3xl flex-col gap-5 p-6'>
                <div className='flex flex-col gap-1'>
                    <p className='text-muted-foreground text-[0.65rem] tracking-wide uppercase'>
                        {subtitle}
                    </p>
                    <h1 className='font-mono text-xl'>{node.moduleName}</h1>
                    <Description text={node.description} />
                </div>

                {member ? <FocusedMember member={member} /> : null}

                <ModuleBody node={node} />
            </div>
        </ScrollArea>
    )
}

export const docsEditor: EditorDefinition = {
    kind: DOCS_EDITOR_KIND,
    mimeTypes: [],
    parsePayload: (raw) => parsePayload(raw),
    titleFor: (payload) => (payload as DocsEditorPayload).moduleId || 'Documentation',
    render: ({ payload }) => <DocsTab payload={payload as DocsEditorPayload} />,
}
