import { type FileIconProps } from './types'

export function FolderOpenFileIcon(props: FileIconProps) {
    return (
        <svg
            xmlns='http://www.w3.org/2000/svg'
            width='16'
            height='16'
            viewBox='0 0 16 16'
            {...props}
        >
            <path
                fill='none'
                stroke='#cdd6f4'
                strokeLinecap='round'
                strokeLinejoin='round'
                d='m1.87 8 .7-2.74a1 1 0 01.96-.76h10.94a1 1 0 01.97 1.24l-1.75 7a1 1 0 01-.97.76H2A1.5 1.5 0 01.5 12V3.5a1 1 0 011-1h5a1 1 0 011 1v1'
            />
        </svg>
    )
}
