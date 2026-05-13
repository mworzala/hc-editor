import { useEffect, useMemo, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import {
    ApiError,
    HCClient,
    HCClientProvider,
    useHCClient,
    useV1ProjectFilesDelete,
    useV1ProjectFilesUpdate,
    useV1ProjectGet,
    v1ProjectEvents,
    v1ProjectFilesGet,
    v1ProjectGetKey,
    type ProjectEventEnvelope,
    type ProjectFile,
} from '@hollowcube/api'
import { Badge, Button, Input, Label, ScrollArea, Textarea } from '@hollowcube/design-system'

import { usePlatform } from '../platform'

export function ApiTestDemo() {
    const [baseUrl, setBaseUrl] = useState('/v1')
    const [projectId, setProjectId] = useState('demo')
    const platform = usePlatform()

    const client = useMemo(
        () => new HCClient({ baseUrl, sendUnsafe: platform.apiTransport }),
        [baseUrl, platform.apiTransport],
    )
    const queryClient = useMemo(() => new QueryClient(), [])

    return (
        <QueryClientProvider client={queryClient}>
            <HCClientProvider client={client}>
                <div className='flex h-full w-full flex-col'>
                    <header className='flex flex-col gap-2 border-b border-border bg-surface px-6 py-3'>
                        <h1 className='text-xl font-medium tracking-tight'>API test</h1>
                        <p className='text-muted-foreground max-w-3xl text-xs'>
                            Exercises every endpoint on @hollowcube/api against a live server.
                            Configure the base URL and project id below, then use each panel to
                            fetch, upload, delete, or stream events.
                        </p>
                    </header>

                    <ScrollArea className='flex-1'>
                        <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 p-6'>
                            <ConfigPanel
                                baseUrl={baseUrl}
                                setBaseUrl={setBaseUrl}
                                projectId={projectId}
                                setProjectId={setProjectId}
                            />
                            <ProjectPanel projectId={projectId} />
                            <UploadPanel projectId={projectId} />
                            <EventsPanel projectId={projectId} />
                        </div>
                    </ScrollArea>
                </div>
            </HCClientProvider>
        </QueryClientProvider>
    )
}

// ----------------------------------------------------------------------------

function ConfigPanel({
    baseUrl,
    setBaseUrl,
    projectId,
    setProjectId,
}: {
    baseUrl: string
    setBaseUrl: (v: string) => void
    projectId: string
    setProjectId: (v: string) => void
}) {
    return (
        <Card title='Config'>
            <div className='flex flex-col gap-3'>
                <div className='flex flex-col gap-1'>
                    <Label htmlFor='api-base-url'>Base URL</Label>
                    <Input
                        id='api-base-url'
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder='http://localhost:8080'
                    />
                </div>
                <div className='flex flex-col gap-1'>
                    <Label htmlFor='api-project-id'>Project id</Label>
                    <Input
                        id='api-project-id'
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                    />
                </div>
            </div>
        </Card>
    )
}

// ----------------------------------------------------------------------------

function ProjectPanel({ projectId }: { projectId: string }) {
    const query = useV1ProjectGet(projectId, {
        enabled: projectId.length > 0,
        retry: 0,
    })
    const queryError = query.error ?? query.failureReason ?? null

    return (
        <Card
            title={
                <span>
                    <Code>GET</Code> /projects/{projectId || '…'}
                </span>
            }
            actions={
                <Button
                    size='sm'
                    variant='outline'
                    onClick={() => query.refetch()}
                    disabled={query.isFetching || projectId.length === 0}
                >
                    {query.isFetching ? 'Fetching…' : 'Refetch'}
                </Button>
            }
        >
            <div className='mb-2 flex items-center gap-2'>
                <Badge variant='outline'>status: {query.status}</Badge>
                {query.isFetching ? <Badge>fetching</Badge> : null}
            </div>
            {queryError ? <ErrorDisplay error={queryError} /> : null}
            {query.data ? (
                <div className='flex flex-col gap-2'>
                    <div className='text-sm'>
                        <strong>{query.data.name}</strong>{' '}
                        <span className='text-muted-foreground'>({query.data.id})</span>
                    </div>
                    {query.data.files.length === 0 ? (
                        <p className='text-muted-foreground text-xs'>No files in project.</p>
                    ) : (
                        <ul className='flex flex-col gap-2'>
                            {query.data.files.map((file) => (
                                <FileItem key={file.path} projectId={projectId} file={file} />
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </Card>
    )
}

function FileItem({ projectId, file }: { projectId: string; file: ProjectFile }) {
    const client = useHCClient()
    const queryClient = useQueryClient()
    const deleteMutation = useV1ProjectFilesDelete()
    const [preview, setPreview] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<unknown>(null)

    const handleView = async () => {
        setError(null)
        setBusy(true)
        try {
            const { bytes, contentType } = await v1ProjectFilesGet(client, projectId, file.path)
            const isText = contentType.startsWith('text/') || contentType === 'application/json'
            setPreview(
                isText
                    ? new TextDecoder().decode(bytes)
                    : `<binary ${bytes.byteLength} bytes, ${contentType}>`,
            )
        } catch (e) {
            setError(e)
        } finally {
            setBusy(false)
        }
    }

    const handleDelete = () => {
        setError(null)
        deleteMutation.mutate(
            { projectId, path: file.path },
            {
                onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: v1ProjectGetKey(projectId) })
                },
                onError: setError,
            },
        )
    }

    return (
        <li className='rounded-md border border-border bg-surface px-3 py-2'>
            <div className='flex flex-wrap items-center gap-2'>
                <code className='text-xs'>{file.path}</code>
                <span className='text-muted-foreground text-xs'>
                    {file.contentType} · {file.size}B
                </span>
                <span className='flex-1' />
                <Button size='sm' variant='outline' onClick={handleView} disabled={busy}>
                    {busy ? 'Loading…' : 'View'}
                </Button>
                <Button
                    size='sm'
                    variant='destructive'
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </Button>
            </div>
            {error ? <ErrorDisplay error={error} /> : null}
            {preview === null ? null : (
                <pre className='mt-2 max-h-48 overflow-auto rounded-sm border border-border bg-background p-2 text-xs'>
                    {preview}
                </pre>
            )}
        </li>
    )
}

// ----------------------------------------------------------------------------

function UploadPanel({ projectId }: { projectId: string }) {
    const [path, setPath] = useState('/notes.txt')
    const [contentType, setContentType] = useState('text/plain')
    const [body, setBody] = useState('hello world\n')
    const [result, setResult] = useState<ProjectFile | null>(null)
    const [error, setError] = useState<unknown>(null)
    const queryClient = useQueryClient()
    const mutation = useV1ProjectFilesUpdate()

    const handleUpload = () => {
        setError(null)
        mutation.mutate(
            { projectId, path, body, contentType },
            {
                onSuccess: (file) => {
                    setResult(file)
                    void queryClient.invalidateQueries({ queryKey: v1ProjectGetKey(projectId) })
                },
                onError: setError,
            },
        )
    }

    return (
        <Card
            title={
                <span>
                    <Code>PUT</Code> /projects/{projectId || '…'}/files/{path}
                </span>
            }
        >
            <div className='flex flex-col gap-3'>
                <div className='flex flex-col gap-1'>
                    <Label htmlFor='upload-path'>Path</Label>
                    <Input
                        id='upload-path'
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                    />
                </div>
                <div className='flex flex-col gap-1'>
                    <Label htmlFor='upload-ct'>Content-Type</Label>
                    <Input
                        id='upload-ct'
                        value={contentType}
                        onChange={(e) => setContentType(e.target.value)}
                    />
                </div>
                <div className='flex flex-col gap-1'>
                    <Label htmlFor='upload-body'>Body</Label>
                    <Textarea
                        id='upload-body'
                        rows={6}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                    />
                </div>
                <div>
                    <Button
                        onClick={handleUpload}
                        disabled={mutation.isPending || projectId.length === 0}
                    >
                        {mutation.isPending ? 'Uploading…' : 'Upload'}
                    </Button>
                </div>
            </div>
            {error ? <ErrorDisplay error={error} /> : null}
            {result ? (
                <pre className='mt-3 max-h-48 overflow-auto rounded-sm border border-border bg-background p-2 text-xs'>
                    {JSON.stringify(result, null, 2)}
                </pre>
            ) : null}
        </Card>
    )
}

// ----------------------------------------------------------------------------

const MAX_EVENTS_SHOWN = 50

function EventsPanel({ projectId }: { projectId: string }) {
    const client = useHCClient()
    const queryClient = useQueryClient()
    const [running, setRunning] = useState(false)
    const [events, setEvents] = useState<ProjectEventEnvelope[]>([])
    const [lastEventId, setLastEventId] = useState<string | undefined>(undefined)
    const [error, setError] = useState<unknown>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => () => abortRef.current?.abort(), [])

    const start = async () => {
        setError(null)
        const ac = new AbortController()
        abortRef.current = ac
        setRunning(true)
        try {
            for await (const evt of v1ProjectEvents(client, projectId, {
                lastEventId,
                signal: ac.signal,
            })) {
                setEvents((prev) => [...prev, evt].slice(-MAX_EVENTS_SHOWN))
                setLastEventId(evt.id)
                queryClient.invalidateQueries({ queryKey: v1ProjectGetKey(projectId) })
            }
        } catch (e) {
            if (!isAbortError(e)) setError(e)
        } finally {
            setRunning(false)
        }
    }

    const stop = () => abortRef.current?.abort()

    return (
        <Card
            title={
                <span>
                    <Code>GET</Code> /projects/{projectId || '…'}/events
                </span>
            }
            actions={
                running ? (
                    <Button size='sm' variant='outline' onClick={stop}>
                        Stop
                    </Button>
                ) : (
                    <Button size='sm' onClick={start} disabled={projectId.length === 0}>
                        Start
                    </Button>
                )
            }
        >
            <div className='mb-2 flex items-center gap-2'>
                <Badge variant={running ? 'default' : 'outline'}>
                    {running ? 'streaming' : 'idle'}
                </Badge>
                <Badge variant='outline'>{events.length} events</Badge>
                {lastEventId === undefined ? null : (
                    <Badge variant='outline'>last id: {lastEventId}</Badge>
                )}
            </div>
            {error ? <ErrorDisplay error={error} /> : null}
            <ul className='max-h-56 overflow-auto rounded-sm border border-border bg-background p-2 text-xs'>
                {events.length === 0 ? (
                    <li className='text-muted-foreground'>
                        No events yet. Upload or delete a file to trigger one.
                    </li>
                ) : (
                    events.map((evt) => (
                        <li key={evt.id} className='font-mono'>
                            <strong>#{evt.id}</strong> {evt.path}
                        </li>
                    ))
                )}
            </ul>
        </Card>
    )
}

// ----------------------------------------------------------------------------

function Card({
    title,
    actions,
    children,
}: {
    title: React.ReactNode
    actions?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <section className='rounded-md border border-border bg-surface p-4'>
            <header className='mb-3 flex items-center justify-between gap-2'>
                <h2 className='text-sm font-medium'>{title}</h2>
                {actions}
            </header>
            {children}
        </section>
    )
}

function Code({ children }: { children: React.ReactNode }) {
    return (
        <code className='rounded-sm bg-background px-1 py-0.5 text-xs font-medium'>{children}</code>
    )
}

function ErrorDisplay({ error }: { error: unknown }) {
    const lines: string[] = []
    if (error instanceof ApiError) {
        lines.push(`ApiError ${error.status}: ${error.message}`)
        if (error.method !== undefined && error.url !== undefined) {
            lines.push(`${error.method} ${error.url}`)
        }
        const cause = (error as Error & { cause?: unknown }).cause
        if (cause instanceof Error && cause.message !== error.message) {
            lines.push(`cause: ${cause.name}: ${cause.message}`)
        }
    } else if (error instanceof Error) {
        lines.push(`${error.name}: ${error.message}`)
    } else {
        lines.push(String(error))
    }
    return (
        <div className='text-destructive border-destructive bg-destructive/10 mt-2 rounded-sm border px-2 py-1 font-mono text-xs whitespace-pre-wrap'>
            {lines.join('\n')}
        </div>
    )
}

function isAbortError(e: unknown): boolean {
    return (
        typeof e === 'object' &&
        e !== null &&
        'name' in e &&
        (e as { name: unknown }).name === 'AbortError'
    )
}
