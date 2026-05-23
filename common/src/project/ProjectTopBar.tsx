import { type CSSProperties } from 'react'
import { PanelBottomIcon, PanelLeftIcon, PanelRightIcon, SettingsIcon } from 'lucide-react'

import { Button, cn } from '@hollowcube/design-system'

import { useDocksVisible, useLayout } from '../model/workspace'
import { usePlatform } from '../platform'
import { type DockId } from '../workspace'
import { useProject } from './context'
import { ConnectionIndicator } from './data/connection-indicator'

/** Width reserved on macOS for the system traffic-light buttons. */
const TRAFFIC_LIGHT_RESERVE = 80
/** Total top-bar height — matches Wails' `InvisibleTitleBarHeight` (44px) so
 *  the traffic lights center vertically within our bar on macOS. */
const TOP_BAR_HEIGHT = 42

// Inline-style typing for non-standard webkit drag-region property.
const dragRegionStyle = {
    WebkitAppRegion: 'drag',
} as CSSProperties
const noDragRegionStyle = {
    WebkitAppRegion: 'no-drag',
} as CSSProperties

export function ProjectTopBar() {
    const project = useProject()
    const { kind: platform } = usePlatform()
    const layout = useLayout()
    const docksVisible = useDocksVisible()
    const toggleDock = (dock: DockId) => layout.toggleDock(dock)

    const isDesktop = platform === 'desktop'

    return (
        <header
            className={cn('bg-background relative flex w-full shrink-0 items-center')}
            style={{
                height: TOP_BAR_HEIGHT,
                ...(isDesktop ? dragRegionStyle : undefined),
            }}
            data-slot='project-top-bar'
        >
            <div className='flex items-center gap-1 pl-2'>
                {isDesktop ? (
                    <span aria-hidden style={{ width: TRAFFIC_LIGHT_RESERVE - 8 }} />
                ) : null}
                <ToggleDockButton
                    dock='left'
                    active={docksVisible.left}
                    onToggle={toggleDock}
                    label='Toggle file panel'
                    icon={<PanelLeftIcon className='size-4' />}
                />
                <ToggleDockButton
                    dock='bottom'
                    active={docksVisible.bottom}
                    onToggle={toggleDock}
                    label='Toggle bottom panel'
                    icon={<PanelBottomIcon className='size-4' />}
                />
                <ToggleDockButton
                    dock='right'
                    active={docksVisible.right}
                    onToggle={toggleDock}
                    label='Toggle right panel'
                    icon={<PanelRightIcon className='size-4' />}
                />
            </div>

            {/* Centered relative to the WINDOW, not the remaining flex space. */}
            <div
                className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
                style={isDesktop ? noDragRegionStyle : undefined}
            >
                <Button
                    className='text-foreground text-sm font-medium tracking-tight'
                    variant='ghost'
                >
                    {project.name}
                </Button>
            </div>

            <div className='ml-auto flex items-center gap-1 pr-2'>
                <ConnectionIndicator desktop={isDesktop} />
                <Button
                    variant='ghost'
                    size='icon'
                    aria-label='Settings'
                    style={isDesktop ? noDragRegionStyle : undefined}
                >
                    <SettingsIcon className='size-4' />
                </Button>
            </div>
        </header>
    )
}

type ToggleDockButtonProps = {
    dock: DockId
    active: boolean
    onToggle: (dock: DockId) => void
    label: string
    icon: React.ReactNode
}

function ToggleDockButton({ dock, active, onToggle, label, icon }: ToggleDockButtonProps) {
    const { kind: platform } = usePlatform()
    const isDesktop = platform === 'desktop'
    return (
        <Button
            variant={active ? 'secondary' : 'ghost'}
            size='icon'
            aria-label={label}
            aria-pressed={active}
            onClick={() => onToggle(dock)}
            style={isDesktop ? noDragRegionStyle : undefined}
        >
            {icon}
        </Button>
    )
}
