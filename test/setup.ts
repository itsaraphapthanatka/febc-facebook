// Force deterministic env values before any src module (and dotenv) is imported.
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.BASE_URL = 'https://example.test';
process.env.LOG_LEVEL = 'fatal';
process.env.DATABASE_URL = 'postgres://febc:febc@localhost:5432/febc_facebook_test';
process.env.ADMIN_API_KEY = 'test-admin-key-1234567890';
process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.FB_APP_ID = '123456789';
process.env.FB_APP_SECRET = 'test-app-secret';
process.env.FB_GRAPH_VERSION = 'v23.0';
process.env.FB_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.OPENAI_MODEL = 'gpt-4o-mini';
process.env.SCHEDULER_TIMEZONE = 'Asia/Bangkok';
