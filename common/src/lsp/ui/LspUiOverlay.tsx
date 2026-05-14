import { useEffect, useRef, useState } from 'react'
import type { CodeAction, Command } from 'vscode-languageserver-types'

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    Input,
    Popover,
    PopoverContent,
} from '@hollowcube/design-system'

import { usePointAnchor } from '../../utils/virtual-anchor'
import { type CodeActionMenuState, type RenamePromptState } from './lsp-ui-bus'
import { useLspUiBus, useLspUiSnapshot } from './lsp-ui-context'

// Top-level overlay that renders the code-action menu + rename input. Mounted
// once near the workspace root so positioning is relative to the viewport.

export function LspUiOverlay() {
    const snap = useLspUiSnapshot()
    const bus = useLspUiBus()
    return (
        <>
            {snap.codeAction ? (
                <CodeActionMenu state={snap.codeAction} onClose={() => bus.closeCodeActionMenu()} />
            ) : null}
            {snap.rename ? (
                <RenamePrompt state={snap.rename} onClose={() => bus.closeRenamePrompt()} />
            ) : null}
        </>
    )
}

function CodeActionMenu({ state, onClose }: { state: CodeActionMenuState; onClose: () => void }) {
    const anchor = usePointAnchor(state.x, state.y)

    if (state.items.length === 0) {
        return (
            <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
                <DropdownMenuContent anchor={anchor} side='bottom' align='start' className='w-72'>
                    <div className='px-2 py-1.5 text-xs text-muted-foreground'>
                        No actions available
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        )
    }

    return (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
            <DropdownMenuContent anchor={anchor} side='bottom' align='start' className='w-80'>
                {groupCodeActions(state.items).map((group, gi) => (
                    <Group
                        key={group.label}
                        label={group.label}
                        firstSection={gi === 0}
                        items={group.items}
                        onPick={(item) => {
                            onClose()
                            state.onSelect(item)
                        }}
                    />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function Group({
    label,
    items,
    firstSection,
    onPick,
}: {
    label: string
    items: (CodeAction | Command)[]
    firstSection: boolean
    onPick: (item: CodeAction | Command) => void
}) {
    return (
        <>
            {firstSection ? null : <DropdownMenuSeparator />}
            <DropdownMenuLabel className='text-[0.65rem] uppercase tracking-wide'>
                {label}
            </DropdownMenuLabel>
            {items.map((item, i) => {
                const ca = item as CodeAction
                const disabled = !!ca.disabled
                return (
                    <DropdownMenuItem
                        key={`${label}-${i}-${item.title}`}
                        disabled={disabled}
                        onClick={() => {
                            if (disabled) return
                            onPick(item)
                        }}
                    >
                        <span>{item.title}</span>
                    </DropdownMenuItem>
                )
            })}
        </>
    )
}

function groupCodeActions(actions: (CodeAction | Command)[]): {
    label: string
    items: (CodeAction | Command)[]
}[] {
    const groups = new Map<string, (CodeAction | Command)[]>()
    for (const item of actions) {
        const kind = (item as CodeAction).kind ?? ''
        const label = labelForKind(kind)
        const list = groups.get(label) ?? []
        list.push(item)
        groups.set(label, list)
    }
    return [...groups.entries()].map(([label, list]) => ({ label, items: list }))
}

function labelForKind(kind: string): string {
    if (!kind) return 'Other'
    if (kind === 'quickfix' || kind.startsWith('quickfix.')) return 'Quick fix'
    if (kind.startsWith('refactor.extract')) return 'Extract'
    if (kind.startsWith('refactor.inline')) return 'Inline'
    if (kind.startsWith('refactor.rewrite')) return 'Rewrite'
    if (kind.startsWith('refactor')) return 'Refactor'
    if (kind === 'source.organizeImports') return 'Source'
    if (kind.startsWith('source')) return 'Source'
    return kind
}

function RenamePrompt({ state, onClose }: { state: RenamePromptState; onClose: () => void }) {
    const anchor = usePointAnchor(state.x, state.y)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const [value, setValue] = useState(state.initialName)

    useEffect(() => {
        const id = window.requestAnimationFrame(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        })
        return () => window.cancelAnimationFrame(id)
    }, [])

    return (
        <Popover open onOpenChange={(open) => !open && onClose()}>
            <PopoverContent
                anchor={anchor}
                side='bottom'
                align='start'
                sideOffset={6}
                className='w-72 p-2'
            >
                <Input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            const trimmed = value.trim()
                            onClose()
                            if (trimmed && trimmed !== state.initialName) {
                                state.onConfirm(trimmed)
                            }
                        } else if (e.key === 'Escape') {
                            e.preventDefault()
                            onClose()
                        }
                    }}
                    placeholder='New name…'
                    aria-label='Rename symbol'
                />
            </PopoverContent>
        </Popover>
    )
}
