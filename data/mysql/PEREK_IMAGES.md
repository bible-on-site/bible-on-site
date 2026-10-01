# Perek images

The editorial record lives in MySQL. `tanah_perek_image` holds the chapter ID, display order, Hebrew alt text, caption, description, credit, and active flag. Each row has zero or more `tanah_perek_image_variant` rows with role, format, pixel dimensions, byte count, and an S3 object key. A chapter can have any number of image records, including none.

Apply [tanah_perek_images_structure.sql](tanah_perek_images_structure.sql) as an additive migration before deploying website code that queries these tables. The local/test db-populator applies it automatically. Keep it out of the production static-data deploy, which drops and recreates tables. There is deliberately no foreign key to `tanah_perek`: the static chapter table is rebuilt independently, while editorial image records must survive those rebuilds.

Upload files to the existing `S3_BUCKET` with the correct `Content-Type` (`image/avif`, `image/webp`, or `image/jpeg`). Use a versioned key for immutable assets and set `Cache-Control: public,max-age=31536000,immutable`. Store keys, rather than full URLs, in the variant table. The website derives public URLs from `S3_ENDPOINT` in local development or the configured AWS bucket and region in production. Each published image needs a WebP display variant; AVIF display sizes and a JPEG social variant are optional. The first active image by `sort_order, id` supplies the page description and social preview; all active images appear in chapter views, structured data, and the image sitemap.

After editing image metadata, revalidate the `perek-images` cache tag and the affected `/929/{id}` path. Rebuild the site to refresh prerendered pages and the sitemap when adding a new image.
