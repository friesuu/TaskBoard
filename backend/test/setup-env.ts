process.env.DB_NAME = 'taskboard_test';
// The tests log in many times per run, which would hit the login rate limit.
// The 'rate limits' test switches it back on to prove it works.
process.env.DISABLE_RATE_LIMIT = 'true';
