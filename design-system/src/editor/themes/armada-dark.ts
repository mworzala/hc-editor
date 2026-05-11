// Armada Dark palette — adapted from
// https://github.com/DavidSeptimus/armada-theme-intellij-plugin
// Kept as raw hex tokens so editor theming stays an island and can be
// retargeted without touching the app's --surface/--card tokens.

export const armadaDark = {
    // Editor chrome
    background: '#1e1f22',
    foreground: '#e0e1e4',
    caret: '#e0e1e4',
    selectionBg: '#225090',
    selectionInactiveBg: '#3a3d43',
    indentGuide: '#353535',

    // Gutter
    gutterBg: '#181818',
    gutterFg: '#6e747b',
    gutterActiveFg: '#e0e1e4',

    // Syntax
    string: '#e394dc',
    number: '#ebc88d',
    keyword: '#82d2ce',
    property: '#af9cff',
    constant: '#82d2ce',
    variable: '#e0e1e4',
    function: '#ebc88d',
    comment: '#909194',
    punctuation: '#d1d1d1',
    operator: '#d1d1d1',
    escape: '#82d2ce',
    invalid: '#ec5d6f',
} as const

export type EditorPalette = typeof armadaDark
