/**
 * Reading this repository's own files as text, for the tests that check artefacts no bundler sees.
 *
 * Four of the files that decide how this surface behaves are not JavaScript and are never imported:
 * `nginx.conf` decides the HTTP status of every address, `index.html` carries the description a
 * link-preview fetcher reads, `Dockerfile` decides what is inside the image, and `src/styles.css`
 * names custom properties that silently invalidate a declaration when they do not exist. Nothing
 * typechecks any of them. Reading them as strings is the only leverage this repository has.
 *
 * ── COMMENTS ARE STRIPPED, AND THAT IS NOT AN OPTIMISATION ────────────────────────────────────
 *
 * The files in this repository EXPLAIN the things they forbid. `nginx.conf`'s header quotes
 * `try_files $uri /index.html` in order to argue against it; `src/styles.css`'s header lists the ten
 * custom properties that do not exist in order to say never to use them; `src/app.tsx` names
 * `ProtectedRoute` in order to say there is none. A grep over the raw bytes matches every one of
 * those explanations and fails a correct file — and a rule that can only be satisfied by deleting
 * the sentence explaining it is a rule somebody deletes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This repository's root, from this file rather than from the process's working directory. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The directory the sibling checkouts live in.
 *
 * One level above this repository, which is where `@cloudsforge/ui` already is: package.json
 * consumes it as `link:../ui/packages/ui`, and CI reproduces that layout by checking each sibling
 * out into its own path beside this one.
 */
export const SIBLINGS = resolve(ROOT, '..')

/** A file in this repository, as text. */
export function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

/** A file in a sibling checkout, or null when that repository is not checked out. */
export function readSibling(relativePath: string): string | null {
  try {
    return readFileSync(join(SIBLINGS, relativePath), 'utf8')
  } catch {
    return null
  }
}

export type CommentSyntax = 'ts' | 'css' | 'html' | 'nginx' | 'yaml'

/**
 * Remove the comments, leaving the declarations.
 *
 * Line offsets are NOT preserved, deliberately. Nothing in this repository cites a line number —
 * neither a comment, nor a commit message, nor a pull request — because a line number names a
 * position in a file somebody else may edit, and the estate has already been burned by exactly
 * that: a cross-repository check that read a cited line went red when the service it cited inserted
 * a row above it, while nothing was wrong in either repository. Every check here searches for the
 * fact instead, so there is nothing for a line number to be useful for.
 */
export function stripComments(source: string, syntax: CommentSyntax): string {
  switch (syntax) {
    case 'ts':
      // JSX comments first (`{/* … */}`), then block comments, then line comments. Line comments
      // are matched only at the start of a line so that a `//` inside a URL survives.
      return source
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
    case 'css':
      return source.replace(/\/\*[\s\S]*?\*\//g, '')
    case 'html':
      return source.replace(/<!--[\s\S]*?-->/g, '')
    case 'nginx':
    case 'yaml':
      return source.replace(/^\s*#.*$/gm, '')
  }
}
