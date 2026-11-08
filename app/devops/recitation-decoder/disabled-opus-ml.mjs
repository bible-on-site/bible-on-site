// Optional ML speech enhancement is not used by recitation playback.
// The explicit directive keeps the bundled wrapper byte-identical to the asset
// built inside web/bible-on-site, whose tsconfig implies alwaysStrict (#2391).
"use strict";
throw new Error("Speech enhancement is disabled in this player");
