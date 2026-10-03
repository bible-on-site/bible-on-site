# Commentary attribution after an app update

The Genesis 4:3 screenshot showed Steinsaltz's commentary under בכור שור.
This was an ID join across different data generations, not a mislabeled source text.

The catalogs in commits `197d9458` and `2b995f69` assign ID 13 to בכור שור.
The catalog and notes committed in `cbde4f60` assign ID 13 to ביאור שטיינזלץ
and ID 15 to בכור שור. The screenshot's text occurs in note `(13,4,3,0)`.
Comparing the older catalog with that catalog finds 91 existing IDs whose names
differ. Both newer SQLite artifacts have build timestamp `1786342208`, proving
they were generated together. The web JSON catalog still contained the older mapping.

The app copied its bundled catalog only when no local copy existed. In contrast,
the notes service updated its database from PAD/ODR. An existing installation could
therefore join new notes to the original catalog indefinitely. The same copy-once
behavior prevented corrections to the bundled Bible text from reaching existing
installations.

The iOS ODR extraction cache also reused an unversioned directory across app
updates, hiding newer store resources behind its existing notes file. It now uses
the app version and build as its cache generation, including the diagnostic path.
Tests reject both prior-build files and the legacy unversioned cache, while
preserving reuse within the same build.

The fix refreshes both bundled databases at initialization, atomically replacing
only changed files. Initialization and copies are serialized. Generated notes now
carry the complete `perush_catalog` ID-to-name mapping in `_metadata`. Before any
notes can be displayed, the app compares this mapping with its current catalog.
Independent generations with the same mapping remain compatible. Legacy notes
must have the same nonzero build timestamp as the catalog. Incompatible notes are
unavailable, and the existing download action can replace them even when a local
file already exists. Both Android PAD and iOS ODR use this service.

All web and app artifacts were regenerated from the Sefaria database. The names
projection used to recognize web citations is now generated with the JSON catalog.
The website's commentary service already joins names and notes within one database;
it does not join the stale JSON catalog to SQL notes.

Regression tests first reproduced the wrong בכור שור label, acceptance of mismatched
packs, inability to replace incompatible local notes, stale Bible text, and differing
web/app mappings. Tests cover compatible independent generations, legacy mismatch,
pack roots and `assets` subdirectories, incompatible downloads, and the committed
artifact mapping. The app release is bumped to 5.0.104 to deliver the fix.
