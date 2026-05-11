import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@hollowcube/design-system/components/breadcrumb'
import { CodeEditor } from '@hollowcube/design-system/editor'
import samplePackage from '@hollowcube/design-system/editor/sample.json'

const SAMPLE_TEXT = JSON.stringify(samplePackage, null, 4)

// Line 7 of the prettified sample is the `"start"` script.
// Lucide `play`, filled emerald.
const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#10b981" stroke="#10b981" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
  <polygon points="6 3 20 12 6 21 6 3"/>
</svg>`

const GUTTER_ICONS: Record<number, string> = {
    7: PLAY_ICON,
}

export default function EditorPage() {
    return (
        <div className='flex h-svh w-full flex-col bg-background'>
            <header className='flex flex-col gap-2 border-b border-border bg-surface px-6 py-4'>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href='/'>hollowcube</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink href='/ds'>Design system</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Code editor</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
                <h1 className='text-2xl font-medium tracking-tight'>Code editor</h1>
                <p className='text-muted-foreground max-w-2xl text-sm'>
                    CodeMirror 6 with the Armada Dark palette. Click in the editor to see the
                    focused active-line tint; click outside to see the blurred tint. Click the fold
                    chevron between line numbers and code to collapse a block. Line 7 (the{' '}
                    <code>start</code> script) has a green play icon in place of its line number.
                </p>
            </header>
            <div className='flex-1 overflow-hidden'>
                <CodeEditor value={SAMPLE_TEXT} gutterIcons={GUTTER_ICONS} />
            </div>
        </div>
    )
}
