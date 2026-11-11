# Librarian

An [Evey](https://github.com/eveyproject/evey) plugin for library housekeeping. It finds what a big collection accumulates silently:

- **Probable duplicates**: the same title present several times. Same year is a probable duplicate copy (wasted disk); different years is a remake or an edition, flagged softer.
- **Saga holes**: numbered series with a missing episode - you keep Rocky II and III but Rocky is gone. Arabic and roman numbering are understood, as are part, chapter and volume wrappers; an unnumbered title counts as episode 1 of its saga.

Detection only: it never touches a file. A clean library shows nothing.

## What it asks for

- `public`: titles, years and types through the host bridge. No network, no stored data.
- Slots: `home.hero` (the tally across every library) and `library.sidebar` (the findings of the library being browsed).

## Design notes

- The backend (`main.js`) is the minimal gRPC lifecycle stub; all behaviour lives in the front modules.
- The front modules are dependency-free scripts written directly in `dist/`. The detection logic's source of truth is `dist/scan.js`; both modules inline it (the sandbox loads one self-contained script) and `tests/scan.test.mjs` fails if a copy drifts.

## Install

Each [release](../../releases) publishes `librarian-<version>.zip`, its cosign
signature (`.zip.sig`) and its sha256. In Evey, open **Admin > Plugins >
Install Plugin > From URL** and paste the URL given in the release notes; the
`#sha256:` it ends with makes Evey check the download, and Evey fetches the
signature next to it on its own. The preview shows **Signed by** the Evey
project key once you trust it.

The Evey project key has the fingerprint `sha256:c29eb603b19d99a50f3fa6c94b7e92c41710779261e73e0fa31d53a78902e09a`. Compare it with the one
the preview shows before you trust it.

## Build

```sh
./scripts/build-zip.sh      # -> out/librarian-<version>.zip
```

The same commit always gives the same zip, so a rebuild can be compared with
a published release byte for byte.

## Release

Bump `version` in `plugin.yaml`, then push a tag `v<version>`. The release
workflow builds, signs with the project key and publishes.

## License

MIT, see [LICENSE](LICENSE).
