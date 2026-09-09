# Bundled SVG Logos

This directory contains the SVG Logos collection used by FORMA's reference gallery.
It is committed with the project so the gallery works without a separate checkout,
network download, or user-specific directory.

- Source repository: https://github.com/korbinjoe/logos
- Source revision: `a5b65275e761a8347a99eded1101c6b130a06e52`
- Imported: 2026-09-07
- `logos.json`: original brand metadata and source links.
- `logos/`: original SVG assets, copied without modification.
- `LICENSE.txt`: original CC0 1.0 Universal license text.

Brand names and logos belong to their respective owners. Source links are retained
in the metadata and displayed by the gallery.

To refresh the collection, replace the index and SVG directory together from the
chosen source revision, preserve its license, and update the revision above.
Run `npm test` after updating to check that all indexed assets remain available.
