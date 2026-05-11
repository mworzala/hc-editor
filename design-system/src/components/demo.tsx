import { Badge } from '@hollowcube/design-system/components/badge'
import { Banner } from '@hollowcube/design-system/components/banner'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@hollowcube/design-system/components/breadcrumb'
import { Button } from '@hollowcube/design-system/components/button'
import { CircleProgress } from '@hollowcube/design-system/components/circle-progress'
import { ColorSwatches } from '@hollowcube/design-system/components/color-swatches'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from '@hollowcube/design-system/components/command'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@hollowcube/design-system/components/dropdown-menu'
import { FileTree, type FileTreeNode } from '@hollowcube/design-system/components/file-tree'
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from '@hollowcube/design-system/components/hover-card'
import { Input } from '@hollowcube/design-system/components/input'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from '@hollowcube/design-system/components/input-group'
import { Label } from '@hollowcube/design-system/components/label'
import { Progress } from '@hollowcube/design-system/components/progress'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@hollowcube/design-system/components/select'
import { Separator } from '@hollowcube/design-system/components/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hollowcube/design-system/components/tabs'
import { Textarea } from '@hollowcube/design-system/components/textarea'
import { ToggleGroup, ToggleGroupItem } from '@hollowcube/design-system/components/toggle-group'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@hollowcube/design-system/components/tooltip'
import { cn } from '@hollowcube/design-system/lib/utils'
import {
    CheckIcon,
    ChevronRightIcon,
    CommandIcon,
    CopyIcon,
    EyeIcon,
    EyeOffIcon,
    FileCodeIcon,
    FileIcon,
    FolderIcon,
    GitBranchIcon,
    ImageIcon,
    InfoIcon,
    MailIcon,
    MoreHorizontalIcon,
    PaletteIcon,
    PencilIcon,
    RocketIcon,
    SearchIcon,
    SettingsIcon,
    ShieldAlertIcon,
    StarIcon,
    TrashIcon,
    UserIcon,
    XIcon,
} from 'lucide-react'
import * as React from 'react'

function Section({
    title,
    description,
    children,
    className,
}: {
    title: string
    description?: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <section className={cn('flex flex-col gap-4', className)}>
            <div className='flex flex-col gap-0.5'>
                <h2 className='text-lg font-medium tracking-tight'>{title}</h2>
                {description ? (
                    <p className='text-muted-foreground text-xs'>{description}</p>
                ) : null}
            </div>
            <div className='rounded-xl border bg-surface p-5'>{children}</div>
        </section>
    )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className='flex flex-col gap-2 md:flex-row md:items-center md:gap-4'>
            <div className='text-muted-foreground w-28 shrink-0 text-xs font-medium tracking-wide uppercase'>
                {label}
            </div>
            <div className='flex flex-wrap items-center gap-2'>{children}</div>
        </div>
    )
}

const SAMPLE_TREE: FileTreeNode[] = [
    {
        type: 'folder',
        name: 'src',
        id: 'src',
        defaultOpen: true,
        children: [
            {
                type: 'folder',
                name: 'components',
                id: 'src/components',
                defaultOpen: true,
                children: [
                    {
                        type: 'file',
                        name: 'button.tsx',
                        id: 'src/components/button.tsx',
                        icon: <FileCodeIcon className='size-3.5 text-blue-300' />,
                    },
                    {
                        type: 'file',
                        name: 'input.tsx',
                        id: 'src/components/input.tsx',
                        icon: <FileCodeIcon className='size-3.5 text-blue-300' />,
                    },
                    {
                        type: 'file',
                        name: 'demo.tsx',
                        id: 'src/components/demo.tsx',
                        icon: <FileCodeIcon className='size-3.5 text-blue-300' />,
                    },
                ],
            },
            {
                type: 'folder',
                name: 'lib',
                id: 'src/lib',
                defaultOpen: false,
                children: [{ type: 'file', name: 'utils.ts', id: 'src/lib/utils.ts' }],
            },
            {
                type: 'folder',
                name: 'assets',
                id: 'src/assets',
                defaultOpen: false,
                children: [
                    {
                        type: 'file',
                        name: 'logo.svg',
                        id: 'src/assets/logo.svg',
                        icon: <ImageIcon className='size-3.5 text-fuchsia-300' />,
                    },
                    {
                        type: 'file',
                        name: 'hero.png',
                        id: 'src/assets/hero.png',
                        icon: <ImageIcon className='size-3.5 text-fuchsia-300' />,
                    },
                ],
            },
            { type: 'file', name: 'index.ts', id: 'src/index.ts' },
        ],
    },
    { type: 'file', name: 'package.json', id: 'package.json' },
    { type: 'file', name: 'tsconfig.json', id: 'tsconfig.json' },
]

const SELECT_ITEMS = [
    { value: 'next', label: 'Next.js' },
    { value: 'vite', label: 'Vite' },
    { value: 'remix', label: 'Remix' },
    { value: 'astro', label: 'Astro' },
]

const COMMAND_ITEMS: Array<{
    group: string
    items: Array<{ id: string; label: string; icon: React.ReactNode; shortcut?: string }>
}> = [
    {
        group: 'Suggestions',
        items: [
            { id: 'new', label: 'New file', icon: <FileIcon />, shortcut: '⌘N' },
            { id: 'open', label: 'Open folder…', icon: <FolderIcon />, shortcut: '⌘O' },
            { id: 'search', label: 'Search everywhere', icon: <SearchIcon />, shortcut: '⌘P' },
        ],
    },
    {
        group: 'Settings',
        items: [
            { id: 'theme', label: 'Change theme…', icon: <PaletteIcon /> },
            {
                id: 'shortcuts',
                label: 'Keyboard shortcuts',
                icon: <CommandIcon />,
                shortcut: '⌘K ⌘S',
            },
            { id: 'settings', label: 'Settings…', icon: <SettingsIcon />, shortcut: '⌘,' },
        ],
    },
]

function ButtonsSection() {
    return (
        <div className='flex flex-col gap-5'>
            <Row label='Primary'>
                <Button size='xs'>XS</Button>
                <Button size='sm'>SM</Button>
                <Button>Default</Button>
                <Button size='lg'>Large</Button>
                <Button disabled>Disabled</Button>
            </Row>
            <Row label='Success'>
                <Button variant='success' size='xs'>
                    XS
                </Button>
                <Button variant='success' size='sm'>
                    SM
                </Button>
                <Button variant='success'>Default</Button>
                <Button variant='success' size='lg'>
                    Large
                </Button>
            </Row>
            <Row label='Warning'>
                <Button variant='warning' size='xs'>
                    XS
                </Button>
                <Button variant='warning' size='sm'>
                    SM
                </Button>
                <Button variant='warning'>Default</Button>
                <Button variant='warning' size='lg'>
                    Large
                </Button>
            </Row>
            <Row label='Error'>
                <Button variant='destructive' size='xs'>
                    XS
                </Button>
                <Button variant='destructive' size='sm'>
                    SM
                </Button>
                <Button variant='destructive'>Default</Button>
                <Button variant='destructive' size='lg'>
                    Large
                </Button>
            </Row>
            <Row label='Icon only'>
                <Button size='icon-xs' variant='outline' aria-label='Edit'>
                    <PencilIcon />
                </Button>
                <Button size='icon-sm' variant='outline' aria-label='Edit'>
                    <PencilIcon />
                </Button>
                <Button size='icon' variant='outline' aria-label='Edit'>
                    <PencilIcon />
                </Button>
                <Button size='icon-lg' variant='outline' aria-label='Edit'>
                    <PencilIcon />
                </Button>
                <Button size='icon' variant='ghost' aria-label='More'>
                    <MoreHorizontalIcon />
                </Button>
                <Button size='icon' variant='destructive' aria-label='Delete'>
                    <TrashIcon />
                </Button>
            </Row>
            <Row label='Other'>
                <Button variant='outline'>Outline</Button>
                <Button variant='secondary'>Secondary</Button>
                <Button variant='ghost'>Ghost</Button>
                <Button variant='link'>Link button</Button>
            </Row>
        </div>
    )
}

function InputsSection() {
    const [show, setShow] = React.useState(false)
    return (
        <div className='grid gap-4 md:grid-cols-2'>
            <div className='flex flex-col gap-1.5'>
                <Label htmlFor='email'>Email</Label>
                <Input
                    id='email'
                    placeholder='you@hollowcube.dev'
                    defaultValue='ada@hollowcube.dev'
                />
                <p className='text-muted-foreground text-xs'>Standard input</p>
            </div>
            <div className='relative flex flex-col gap-1.5'>
                <Label htmlFor='email-err'>Email (error)</Label>
                <Input
                    id='email-err'
                    placeholder='you@hollowcube.dev'
                    aria-invalid
                    defaultValue='not-an-email'
                />
                <p className='text-muted-foreground text-xs'>
                    We&apos;ll only use this for important account alerts.
                </p>
                <div
                    role='alert'
                    className='absolute top-[calc(100%-1.25rem)] left-0 z-10 flex items-center gap-1.5 rounded-md bg-destructive px-2 py-1 text-[0.7rem] leading-none text-destructive-foreground shadow-lg ring-1 ring-destructive/40'
                >
                    <ShieldAlertIcon className='size-3' />
                    Enter a valid email address.
                </div>
            </div>
            <div className='flex flex-col gap-1.5'>
                <Label htmlFor='email-disabled'>Disabled</Label>
                <Input id='email-disabled' disabled defaultValue='locked@hollowcube.dev' />
            </div>
            <div className='flex flex-col gap-1.5'>
                <Label htmlFor='email-active'>Active / focused</Label>
                <Input
                    id='email-active'
                    defaultValue='focused-by-default'
                    className='border-primary ring-3 ring-primary/30'
                />
                <p className='text-muted-foreground text-xs'>Visually simulated focus state.</p>
            </div>

            <div className='flex flex-col gap-1.5 md:col-span-2'>
                <Label htmlFor='search'>Search (icon at start)</Label>
                <InputGroup>
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput id='search' placeholder='Search anything…' />
                    <InputGroupAddon align='inline-end'>
                        <kbd className='text-muted-foreground inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px]'>
                            ⌘K
                        </kbd>
                    </InputGroupAddon>
                </InputGroup>
            </div>

            <div className='flex flex-col gap-1.5 md:col-span-2'>
                <Label htmlFor='password'>Password (toggle button at end)</Label>
                <InputGroup>
                    <InputGroupAddon>
                        <ShieldAlertIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                        id='password'
                        type={show ? 'text' : 'password'}
                        defaultValue='super-secret-123'
                    />
                    <InputGroupAddon align='inline-end'>
                        <InputGroupButton
                            aria-label={show ? 'Hide password' : 'Show password'}
                            onClick={() => setShow((v) => !v)}
                        >
                            {show ? <EyeOffIcon /> : <EyeIcon />}
                        </InputGroupButton>
                        <InputGroupButton aria-label='Copy'>
                            <CopyIcon />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </div>

            <div className='flex flex-col gap-1.5 md:col-span-2'>
                <Label htmlFor='message'>Textarea</Label>
                <Textarea
                    id='message'
                    rows={3}
                    placeholder='Tell us about your project…'
                    defaultValue='A monorepo with a shared design system, a web app, and a Wails desktop app.'
                />
            </div>
        </div>
    )
}

function BadgesSection() {
    return (
        <Row label='Badges'>
            <Badge>Default</Badge>
            <Badge variant='secondary'>Secondary</Badge>
            <Badge variant='outline'>Outline</Badge>
            <Badge variant='ghost'>Ghost</Badge>
            <Badge variant='destructive'>Error</Badge>
            <Badge variant='success'>Success</Badge>
            <Badge variant='warning'>Warning</Badge>
            <Badge>
                <StarIcon data-icon='inline-start' /> Starred
            </Badge>
        </Row>
    )
}

function BannersSection() {
    return (
        <div className='flex flex-col gap-3'>
            <Banner
                variant='info'
                icon={<InfoIcon />}
                title='A new editor version is available'
                description='v0.4.2 ships keyboard navigation in the file tree and faster startup.'
                primaryCta={{ label: 'Update now' }}
                secondaryCta={{ label: 'Release notes' }}
                onDismiss={() => {}}
            />
            <Banner
                variant='success'
                icon={<RocketIcon />}
                title='Deploy succeeded'
                description='hollowcube-editor-prod went live 2 minutes ago.'
                primaryCta={{ label: 'Open dashboard' }}
            />
            <Banner
                variant='warning'
                icon={<ShieldAlertIcon />}
                title='Storage at 92%'
                description='Some workflows may slow down once you cross 95%.'
                secondaryCta={{ label: 'Manage storage' }}
            />
            <Banner
                variant='error'
                icon={<XIcon />}
                title='Sync failed'
                description="We couldn't reach the workspace server. Local changes are safe."
                primaryCta={{ label: 'Retry sync' }}
                secondaryCta={{ label: 'View logs' }}
            />
        </div>
    )
}

function TabsSection() {
    return (
        <Tabs defaultValue='overview' className='w-full'>
            <TabsList>
                <TabsTrigger value='overview'>Overview</TabsTrigger>
                <TabsTrigger value='activity'>Activity</TabsTrigger>
                <TabsTrigger value='settings'>Settings</TabsTrigger>
                <TabsTrigger value='locked' disabled>
                    Locked
                </TabsTrigger>
            </TabsList>
            <TabsContent value='overview' className='text-muted-foreground pt-4 text-sm'>
                Drop in any panel content here. Tabs are powered by base-ui under the hood.
            </TabsContent>
            <TabsContent value='activity' className='text-muted-foreground pt-4 text-sm'>
                Recent activity stream lives in this tab.
            </TabsContent>
            <TabsContent value='settings' className='text-muted-foreground pt-4 text-sm'>
                Workspace preferences live in this tab.
            </TabsContent>
        </Tabs>
    )
}

function ToggleChipsSection() {
    const [view, setView] = React.useState<string[]>(['grid'])
    const [filters, setFilters] = React.useState<string[]>(['open', 'starred'])
    const singleValue = view[0] ?? ''
    const handleViewChange = React.useCallback((v: string[]) => {
        if (v.length > 0) setView(v)
    }, [])
    return (
        <div className='flex flex-col gap-5'>
            <div className='flex flex-col gap-2'>
                <div className='text-muted-foreground text-xs'>
                    Single select — view mode:{' '}
                    <span className='text-foreground'>{singleValue || 'none'}</span>
                </div>
                <ToggleGroup value={view} onValueChange={handleViewChange}>
                    <ToggleGroupItem value='list'>List</ToggleGroupItem>
                    <ToggleGroupItem value='grid'>Grid</ToggleGroupItem>
                    <ToggleGroupItem value='kanban'>Kanban</ToggleGroupItem>
                    <ToggleGroupItem value='timeline'>Timeline</ToggleGroupItem>
                </ToggleGroup>
            </div>
            <div className='flex flex-col gap-2'>
                <div className='text-muted-foreground text-xs'>
                    Multi select — filters:{' '}
                    <span className='text-foreground'>{filters.join(', ') || 'none'}</span>
                </div>
                <ToggleGroup multiple value={filters} onValueChange={setFilters}>
                    <ToggleGroupItem value='open'>Open</ToggleGroupItem>
                    <ToggleGroupItem value='starred'>Starred</ToggleGroupItem>
                    <ToggleGroupItem value='mine'>Assigned to me</ToggleGroupItem>
                    <ToggleGroupItem value='archived'>Archived</ToggleGroupItem>
                </ToggleGroup>
            </div>
        </div>
    )
}

function BreadcrumbsSection() {
    return (
        <Breadcrumb>
            <BreadcrumbList>
                <BreadcrumbItem>
                    <BreadcrumbLink href='#'>Workspace</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                    <BreadcrumbLink href='#'>hollowcube</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                    <BreadcrumbLink href='#'>editor</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                    <BreadcrumbPage>design-system</BreadcrumbPage>
                </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
    )
}

function ProgressSection() {
    return (
        <div className='grid gap-6 md:grid-cols-2'>
            <div className='flex flex-col gap-3'>
                <div className='text-muted-foreground text-xs'>Line progress</div>
                <Progress value={25} />
                <Progress value={62} />
                <Progress value={94} />
            </div>
            <div className='flex items-center justify-center gap-6'>
                <CircleProgress value={25} label='Sync' />
                <CircleProgress value={62} label='Build' />
                <CircleProgress value={94} label='Deploy' size={72} strokeWidth={6} />
            </div>
        </div>
    )
}

function SelectSection() {
    const [framework, setFramework] = React.useState<string | null>('vite')
    return (
        <div className='flex max-w-sm flex-col gap-2'>
            <Label htmlFor='fw'>Framework (open by default)</Label>
            <Select value={framework} onValueChange={setFramework} defaultOpen>
                <SelectTrigger id='fw'>
                    <SelectValue placeholder='Pick a framework' />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectLabel>Frameworks</SelectLabel>
                        {SELECT_ITEMS.map((i) => (
                            <SelectItem key={i.value} value={i.value}>
                                {i.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
    )
}

function DropdownSection() {
    return (
        <div className='flex justify-start'>
            <DropdownMenu defaultOpen>
                <DropdownMenuTrigger
                    render={
                        <Button variant='outline'>
                            Account menu <ChevronRightIcon />
                        </Button>
                    }
                />
                <DropdownMenuContent align='start' side='bottom' sideOffset={6}>
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>My account</DropdownMenuLabel>
                        <DropdownMenuItem>
                            <UserIcon />
                            Profile
                            <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            <SettingsIcon />
                            Settings
                            <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuCheckboxItem checked>Notifications</DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem>Beta features</DropdownMenuCheckboxItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <PaletteIcon />
                            Appearance
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            <DropdownMenuItem>System</DropdownMenuItem>
                            <DropdownMenuItem>
                                <CheckIcon /> Dark
                            </DropdownMenuItem>
                            <DropdownMenuItem>Light</DropdownMenuItem>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant='destructive'>
                        <TrashIcon />
                        Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

function TooltipSection() {
    return (
        <div className='flex items-center gap-6'>
            <Tooltip defaultOpen>
                <TooltipTrigger
                    render={
                        <Button variant='outline' size='icon' aria-label='Help'>
                            <InfoIcon />
                        </Button>
                    }
                />
                <TooltipContent side='top'>Pinned tooltip — interactive</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button variant='ghost' size='icon' aria-label='Star'>
                            <StarIcon />
                        </Button>
                    }
                />
                <TooltipContent>Hover-only tooltip</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button variant='ghost' size='icon' aria-label='Mail'>
                            <MailIcon />
                        </Button>
                    }
                />
                <TooltipContent>Send a message</TooltipContent>
            </Tooltip>
        </div>
    )
}

function HoverCardSection() {
    return (
        <HoverCard defaultOpen>
            <HoverCardTrigger render={<Button variant='link'>@hollowcube</Button>} />
            <HoverCardContent side='bottom' align='start' className='w-72'>
                <div className='flex items-start gap-3'>
                    <div className='bg-primary/20 text-primary flex size-9 items-center justify-center rounded-full'>
                        <UserIcon className='size-4' />
                    </div>
                    <div className='flex min-w-0 flex-1 flex-col gap-1'>
                        <div className='flex items-center gap-1.5'>
                            <span className='text-sm font-medium'>@hollowcube</span>
                            <Badge variant='secondary' className='h-4 px-1.5 text-[10px]'>
                                Pro
                            </Badge>
                        </div>
                        <p className='text-muted-foreground text-xs'>
                            Building a desktop-first editor on top of Wails v3 and base-ui.
                        </p>
                        <div className='text-muted-foreground flex items-center gap-3 text-[11px]'>
                            <span className='inline-flex items-center gap-1'>
                                <GitBranchIcon className='size-3' /> 42 repos
                            </span>
                            <span>Joined 2024</span>
                        </div>
                        <div className='mt-1 flex gap-2'>
                            <Button size='xs'>Follow</Button>
                            <Button size='xs' variant='outline'>
                                Message
                            </Button>
                        </div>
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    )
}

function CommandPaletteSection() {
    const [value, setValue] = React.useState('')
    return (
        <div className='overflow-hidden rounded-xl border bg-popover'>
            <Command>
                <CommandInput
                    placeholder='Type a command or search…'
                    value={value}
                    onValueChange={setValue}
                />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    {COMMAND_ITEMS.map((group, idx) => (
                        <React.Fragment key={group.group}>
                            {idx > 0 ? <CommandSeparator /> : null}
                            <CommandGroup heading={group.group}>
                                {group.items.map((item) => (
                                    <CommandItem key={item.id}>
                                        {item.icon}
                                        <span>{item.label}</span>
                                        {item.shortcut ? (
                                            <CommandShortcut>{item.shortcut}</CommandShortcut>
                                        ) : null}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </React.Fragment>
                    ))}
                </CommandList>
            </Command>
        </div>
    )
}

function FileTreeSection() {
    const [selected, setSelected] = React.useState<string | null>('src/components/demo.tsx')
    return (
        <div className='grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]'>
            <div className='rounded-lg border bg-popover p-2'>
                <FileTree
                    nodes={SAMPLE_TREE}
                    selectedId={selected}
                    onSelect={(id, node) => {
                        if (node.type === 'file') setSelected(id)
                    }}
                />
            </div>
            <div className='text-muted-foreground flex items-start gap-2 rounded-lg border bg-card/60 p-4 text-xs'>
                <FolderIcon className='mt-0.5 size-4 shrink-0 text-amber-300' />
                <div>
                    <div className='text-foreground text-sm font-medium'>Selected</div>
                    <code className='break-all'>{selected ?? '—'}</code>
                </div>
            </div>
        </div>
    )
}

function Demo() {
    return (
        <TooltipProvider delay={100}>
            <div className='bg-background min-h-svh'>
                <div className='mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10'>
                    <header className='flex flex-col gap-2'>
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink href='/'>hollowcube</BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>Design system</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                        <h1 className='text-3xl font-medium tracking-tight'>Design system</h1>
                        <p className='text-muted-foreground max-w-2xl text-sm'>
                            Reference for tokens, components, and patterns in{' '}
                            <code>@hollowcube/design-system</code>. Overlay components (menus,
                            tooltips, hover cards, selects) render expanded by default and remain
                            fully interactive.
                        </p>
                    </header>

                    <Separator />

                    <Section
                        title='Color tokens'
                        description='Background, primary, and secondary scales pulled from the b1Ymqvicc theme.'
                    >
                        <ColorSwatches />
                    </Section>

                    <Section
                        title='Buttons'
                        description='Primary, success, warning, error variants in all sizes plus icon-only.'
                    >
                        <ButtonsSection />
                    </Section>

                    <Section
                        title='Inputs'
                        description='Text, textarea, error, focused, and input groups with leading icons / trailing actions.'
                    >
                        <InputsSection />
                    </Section>

                    <Section title='Badges'>
                        <BadgesSection />
                    </Section>

                    <Section
                        title='Toggle chips'
                        description='Single- and multi-select chip groups.'
                    >
                        <ToggleChipsSection />
                    </Section>

                    <Section title='Breadcrumbs'>
                        <BreadcrumbsSection />
                    </Section>

                    <Section title='Tabs'>
                        <TabsSection />
                    </Section>

                    <Section
                        title='Progress'
                        description='Line + circle indicators sharing the primary token.'
                    >
                        <ProgressSection />
                    </Section>

                    <Section
                        title='Banners'
                        description='Info, success, warning, error — with optional primary and secondary CTAs.'
                    >
                        <BannersSection />
                    </Section>

                    <Section
                        title='Select'
                        description='Native-feeling, keyboard-friendly select. Open by default.'
                    >
                        <SelectSection />
                    </Section>

                    <Section
                        title='Dropdown menu'
                        description='With submenu, checkbox items, shortcuts, and an icon per item.'
                    >
                        <DropdownSection />
                    </Section>

                    <Section
                        title='Tooltip'
                        description='The first tooltip is pinned open; the others are hover-only.'
                    >
                        <TooltipSection />
                    </Section>

                    <Section
                        title='Hover card'
                        description='User profile card with actions. Pinned open.'
                    >
                        <HoverCardSection />
                    </Section>

                    <Section
                        title='File tree'
                        description='Recursive folders + files. Click folders to expand, files to select.'
                    >
                        <FileTreeSection />
                    </Section>

                    <Section
                        title='Command palette'
                        description='Inline command palette — type to filter, click to invoke.'
                    >
                        <CommandPaletteSection />
                    </Section>
                </div>
            </div>
        </TooltipProvider>
    )
}

export { Demo }
