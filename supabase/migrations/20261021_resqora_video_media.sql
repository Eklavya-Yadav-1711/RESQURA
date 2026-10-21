-- Allow short SOS videos alongside the existing single-photo media field.
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/3gpp'
    ]
where id = 'sos-media';
