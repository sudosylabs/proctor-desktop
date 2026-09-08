# Proctor branding notices

The artwork in this directory is copied unchanged from the Proctor repository's
approved `brand/` pack. The [manifest](manifest.json) records each package-local
path, canonical source path, accepted SHA-256 digest, and source revision.
Desktop builds and tests use only these copies and never read another checkout.

LaunchWindow uses the supplied vertical 2.5D lockups under `source/`, matching
the dark or light surface. The flat marks and horizontal lockups remain in the
approved asset inventory.
The Windows and Linux default icons use the supplied purple `light` 2.5D exports;
`light` describes the surface behind the artwork. The macOS ICNS is the supplied
export of the Apple Icon Composer artwork, preserving its native material
treatment and representations.

Desktop does not generate or re-encode artwork or produce resized asset files.
To update the copies, use the needed finished files from the approved pack without modification,
review the manifest's source paths and digests, and run `npm run test:checks`.
Asset checks validate the local inventory, digests, formats, and dimensions.

The Proctor wordmark outlines in the lockup SVG files were created from IBM
Plex Sans Medium. IBM Plex is Copyright 2017 IBM Corp. with Reserved Font Name
"Plex" and is distributed under the SIL Open Font License, Version 1.1. The
font file is not included in Proctor Desktop; the applicable license text is in
[`licenses/IBM-Plex-OFL-1.1.txt`](licenses/IBM-Plex-OFL-1.1.txt).
