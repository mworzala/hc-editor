import { type ReactNode } from 'react'

import {
    JsonFileIcon,
    LuaFileIcon,
    LuauFileIcon,
    MarkdownFileIcon,
    TextFileIcon,
    UnknownFileIcon,
    type FileIconProps,
} from '@hollowcube/design-system'

// Path-based file-type → icon resolver. Path-based (not mime-based) because the
// server's contentType is often `text/plain` for `.luau` — extension is the
// stronger signal. Mirrors the same fallback in editors/text.tsx
// (mimeFromExtension).

type FileIconComponent = (props: FileIconProps) => ReactNode

export function getFileIconComponent(path: string): FileIconComponent {
    const dot = path.lastIndexOf('.')
    if (dot === -1) return UnknownFileIcon
    const ext = path.slice(dot + 1).toLowerCase()
    switch (ext) {
        case 'luau':
            return LuauFileIcon
        case 'lua':
            return LuaFileIcon
        case 'json':
            return JsonFileIcon
        case 'md':
        case 'markdown':
            return MarkdownFileIcon
        case 'txt':
            return TextFileIcon
        default:
            return UnknownFileIcon
    }
}

/** Render the icon at the standard tree/tab size. */
export function renderFileIcon(path: string): ReactNode {
    const Icon = getFileIconComponent(path)
    return <Icon className='size-3.5' />
}
