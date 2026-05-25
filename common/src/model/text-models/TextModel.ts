// `TextModel` — per-document state: the CodeMirror `Text` doc, the
// last-saved snapshot, dirty (computed), path, orphaned, tempId. The
// factory returns a `TextModelInternal` that includes the writable
// operations `TextModelService` needs (`commit`, `setPath`,
// `setOriginal`, `markOrphaned`). Consumers receive `TextModel` (the
// read-only view) via the service's `get`/`getOrOpen`.
//
// Document representation:
//   • `text: ReadonlySignal<Text>` is the canonical doc — a CodeMirror
//     `Text` rope. Views drive changes through `applyChanges(changes,
//     origin)`; the model updates `_text = changes.apply(_text)` and
//     fires a `changes` event so *other* views attached to the same
//     model can dispatch the same ChangeSet (preserving cursor/scroll
//     by construction — no full-doc replace).
//   • `content: ReadonlySignal<string>` is derived (`computed`) from
//     `text`. Kept for consumers that need a string snapshot (save,
//     LspBufferBridge, search-result preview, file-tree rename body).
//     The derivation only recomputes when read; `.peek()` users pay
//     toString once per call.
//   • `setContent(s)` / `discard()` are convenience wrappers that
//     build a full-replace ChangeSet and route through `applyChanges`
//     — so external sources (SSE, conflict resolution, save-as) still
//     reach attached views as transactions.

import { ChangeSet, Text } from '@codemirror/state'

import { Emitter, type Event } from '../foundation/emitter'
import { computed, signal, type ReadonlySignal, type Signal } from '../foundation/signal'

export type DocumentId = string

/** Identifier carried on a `TextModelChange` event. Views attached to
 *  the model use this to suppress echo: a view tags its own dispatches
 *  with a per-mount symbol and ignores incoming changes whose origin
 *  matches. The model itself uses `null` for changes that originate
 *  from outside any view (SSE, discard, setContent). */
export type ChangeOrigin = symbol | string | null

export type TextModelChange = {
    changes: ChangeSet
    origin: ChangeOrigin
}

export interface TextModel {
    readonly id: DocumentId
    readonly tempId: string | null
    readonly path: ReadonlySignal<string | null>
    /** The canonical document state. Views read this to seed their
     *  initial EditorState and subscribe to `changes` for live syncs. */
    readonly text: ReadonlySignal<Text>
    /** String view of `text`. Lazily computed; pay toString on read.
     *  Prefer `text.peek()` when you need length/lines/slices — those
     *  are O(log n) on `Text` and avoid materialising the full string. */
    readonly content: ReadonlySignal<string>
    readonly original: ReadonlySignal<string>
    readonly dirty: ReadonlySignal<boolean>
    readonly orphaned: ReadonlySignal<boolean>
    /** Stream of changes applied to the doc. Views subscribe to this
     *  to mirror updates from sibling views (and from external sources
     *  like SSE) without going through a React re-render. */
    readonly changes: Event<TextModelChange>
    /** Apply a CodeMirror ChangeSet against the current doc. `origin`
     *  tags the change so the originator can ignore the echo. */
    applyChanges(changes: ChangeSet, origin?: ChangeOrigin): void
    /** Replace the entire doc with `content`. Convenience wrapper —
     *  builds a full-replace ChangeSet and routes through
     *  `applyChanges` so attached views see a proper transaction. */
    setContent(content: string): void
    /** Revert the doc to `original`. Same transaction-routing as
     *  `setContent`. */
    discard(): void
}

export interface TextModelInternal extends TextModel {
    commit(savedSnapshot: string): void
    setPath(path: string): void
    setOriginal(value: string): void
    markOrphaned(): void
    /** Mutate the id (used when promoting an untitled doc to its path). */
    rekey(newId: DocumentId): void
}

export interface CreateTextModelArgs {
    id: DocumentId
    tempId: string | null
    path: string | null
    initialContent: string
}

export function createTextModel(args: CreateTextModelArgs): TextModelInternal {
    let mutableId = args.id
    let mutableTempId = args.tempId
    const _path: Signal<string | null> = signal(args.path)
    const _text: Signal<Text> = signal(Text.of(args.initialContent.split('\n')))
    const _original: Signal<string> = signal(args.initialContent)
    const _orphaned: Signal<boolean> = signal(false)
    // `content` and `dirty` are derived. The dirty check materialises
    // the string — fine for most files; large-file optimisations would
    // compare length + a rolling hash, but that's premature today.
    const _content: ReadonlySignal<string> = computed(() => _text.value.toString())
    const _dirty: ReadonlySignal<boolean> = computed(() => _content.value !== _original.value)
    const _changes = new Emitter<TextModelChange>()

    function applyChanges(changes: ChangeSet, origin: ChangeOrigin = null): void {
        if (changes.empty) return
        _text.value = changes.apply(_text.peek())
        _changes.fire({ changes, origin })
    }

    function replaceAll(next: string, origin: ChangeOrigin): void {
        const current = _text.peek()
        if (current.length === 0 && next.length === 0) return
        if (current.toString() === next) return
        const changes = ChangeSet.of(
            [{ from: 0, to: current.length, insert: next }],
            current.length,
        )
        applyChanges(changes, origin)
    }

    return {
        get id() {
            return mutableId
        },
        get tempId() {
            return mutableTempId
        },
        path: _path,
        text: _text,
        content: _content,
        original: _original,
        dirty: _dirty,
        orphaned: _orphaned,
        changes: _changes.event,

        applyChanges,
        setContent(content) {
            replaceAll(content, null)
        },
        discard() {
            replaceAll(_original.peek(), null)
        },
        commit(savedSnapshot) {
            _original.value = savedSnapshot
        },
        setPath(path) {
            _path.value = path
        },
        setOriginal(value) {
            _original.value = value
        },
        markOrphaned() {
            _orphaned.value = true
        },
        rekey(newId) {
            mutableId = newId
            mutableTempId = null
        },
    }
}
