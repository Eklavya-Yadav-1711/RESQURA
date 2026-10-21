-- Ensure PostgREST sees the SOS chat table immediately after deployment.
notify pgrst, 'reload schema';
