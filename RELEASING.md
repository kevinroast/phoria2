# Releasing phoria2

How a new version gets to npm. The short version: **bump the version with `npm version`, push the
commit and its tag, and GitHub publishes it.** Nothing is published from your machine.

## How it works

- Pushing a tag that starts with `v` (like `v1.0.0`) to GitHub runs the **Publish** workflow
  ([.github/workflows/publish.yml](.github/workflows/publish.yml)).
- The workflow checks the tag matches the version in `package.json`, then runs `npm publish`. That
  runs the `prepublishOnly` checks first - lint, typecheck, tests and the build - so a broken build
  can't go out.
- It signs in to npm with npm's **trusted publishing** (no npm token is stored anywhere), and
  attaches **provenance**: npmjs.com shows which commit and workflow run built each version.
- **Release candidates** (versions with a `-`, like `1.0.0-rc.3`) are published with the npm tag
  `next`. **Full releases** (like `1.0.0`) are published as `latest`, which is what
  `npm install phoria2` installs.

## Before you start

- Everything you want in the release is committed and pushed, and the **CI** run for it on GitHub
  is green: <https://github.com/kevinroast/phoria2/actions>
- You're in the phoria2 folder, with nothing uncommitted (`npm version` refuses to run otherwise):

  ```sh
  cd H:\kevs3d\phoria2
  git status
  ```

## Choosing the version number

Versions are `MAJOR.MINOR.PATCH` ([semver](https://semver.org)). After 1.0, people rely on these:

| Change | Command | Example |
|---|---|---|
| Bug fixes only | `npm version patch` | 1.0.0 → 1.0.1 |
| New features, nothing breaks | `npm version minor` | 1.0.1 → 1.1.0 |
| Anything that breaks existing code | `npm version major` | 1.1.0 → 2.0.0 |
| Another release candidate | `npm version prerelease --preid rc` | 1.0.0-rc.2 → 1.0.0-rc.3 |
| An exact version | `npm version 1.0.0` | 1.0.0-rc.3 → 1.0.0 |

Before a big release, a release candidate (`-rc.N`) lets people try it with
`npm install phoria2@next` while `npm install phoria2` stays on the last full release.

## The release

0. **Update the README's CDN example.** Its import map pins the version (`phoria2@1.0.0-rc.2/...`):
   change it to the version you're about to release, and commit that first.

1. **Bump the version.** This edits `package.json` and `package-lock.json`, commits them, and tags
   that commit `v<version>` - all in one go, so the tag can't end up on the wrong commit:

   ```sh
   npm version prerelease --preid rc
   ```

   (or `npm version patch` / `minor` / `major` / an exact version, from the table above)

2. **Push the commit, then the tag:**

   ```sh
   git push
   git push --tags
   ```

3. **Watch it publish.** A **Publish** run appears on the Actions page, next to the usual CI run,
   and takes about half a minute: <https://github.com/kevinroast/phoria2/actions>

4. **Check it's on npm.** The registry can take a few minutes to show a new version:

   ```sh
   npm view phoria2 versions
   npm view phoria2 dist-tags
   ```

   The package page should show the new version and a provenance badge:
   <https://www.npmjs.com/package/phoria2>

5. **Optional - release notes.** On GitHub, open the tag under *Releases* > *Draft a new release*,
   pick the tag, and write what changed. Tick *Set as a pre-release* for release candidates.

6. **Optional - kevs3d.** phoria2 is a submodule of kevs3d, which records which phoria2 commit it
   points at. To move it to the release, commit in kevs3d: the client shows `phoria2` as changed.

## If something goes wrong

**The Publish run failed.** Open it on the Actions page and read the failing step:

- *Tag doesn't match package.json version* - the tag was put on a commit with a different version.
  Delete the tag and tag the right commit (below).
- *A lint, typecheck, test or build step failed* - fix it, commit, then make the next version
  (the failed one was never published, but the tag exists): `npm version prerelease --preid rc`.
- *An authentication error (E401, E403, ENEEDAUTH)* - check trusted publishing on npmjs.com: the
  package's *Settings* > *Trusted publisher* should be GitHub Actions, owner `kevinroast`,
  repository `phoria2`, workflow `publish.yml`.

**A tag is on the wrong commit** (or needs redoing before anything was published). Delete it here
and on GitHub, then tag again:

```sh
git tag -d v1.0.0-rc.3
git push origin :refs/tags/v1.0.0-rc.3
git tag v1.0.0-rc.3
git push origin v1.0.0-rc.3
```

**npm says the version already exists.** A version number can only ever be published once, even
if it's later removed. Make the next version instead.

**A published version is broken.** Don't try to remove it - publish a fixed version, then warn
anyone still on the bad one (this shows when they install it, and can be undone):

```sh
npm deprecate phoria2@1.0.1 "broken - use 1.0.2"
```

(`npm unpublish` only works within 72 hours of publishing, and the number can never be reused, so
deprecating is almost always better.)

## Useful commands

```sh
npm view phoria2                    # what's on npm: versions, tags, links
npm view phoria2 dist-tags          # which version 'latest' and 'next' point at
npm dist-tag add phoria2@1.0.0 latest   # point a tag at a version by hand (from your machine)
npm whoami                          # which npm account you're signed in as
npm pack --dry-run                  # list exactly what would be published, without publishing
```
