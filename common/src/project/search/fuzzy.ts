// Tiny fuzzy scorer. Case-insensitive subsequence match with bonuses for
// prefix match, word-boundary starts, and consecutive runs.
//
// Returns `null` when the query doesn't match. Otherwise returns a score
// (higher is better) and the indices in `candidate` of each matched
// character — the UI uses these to bold the hit characters.

export type FuzzyMatch = {
    score: number
    /** Indices into `candidate` (lowercased input). */
    matches: number[]
}

const BONUS_CONSECUTIVE = 8
const BONUS_WORD_START = 6
const BONUS_PREFIX = 10
const PENALTY_GAP = -1

const WORD_SEPARATORS = new Set(['/', '\\', '-', '_', '.', ' '])

export function fuzzyScore(query: string, candidate: string): FuzzyMatch | null {
    if (!query) return { score: 0, matches: [] }
    const q = query.toLowerCase()
    const c = candidate.toLowerCase()

    const matches: number[] = []
    let score = 0
    let qi = 0
    let lastMatch = -1

    for (let i = 0; i < c.length && qi < q.length; i++) {
        if (c[i] !== q[qi]) continue

        let bonus = 0
        if (i === 0) bonus += BONUS_PREFIX
        if (i > 0 && WORD_SEPARATORS.has(c[i - 1]!)) bonus += BONUS_WORD_START
        if (i > 0 && isCamelStart(candidate, i)) bonus += BONUS_WORD_START
        if (lastMatch === i - 1) bonus += BONUS_CONSECUTIVE
        else if (lastMatch !== -1) score += (i - lastMatch - 1) * PENALTY_GAP

        score += 10 + bonus
        matches.push(i)
        lastMatch = i
        qi++
    }

    if (qi !== q.length) return null
    return { score, matches }
}

function isCamelStart(s: string, i: number): boolean {
    const prev = s[i - 1]
    const curr = s[i]
    if (!prev || !curr) return false
    return prev === prev.toLowerCase() && curr === curr.toUpperCase() && prev !== curr
}
