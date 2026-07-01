// Runs in each Jest worker before modules are imported.
// Sets env vars so DynamoDB client and handler use test infrastructure.
process.env.AWS_ENDPOINT_URL = 'http://localhost:8001';
process.env.TABLE_NAME = 'smolt-test';
process.env.ORIGIN_SECRET = 'test-secret';
process.env.AWS_ACCESS_KEY_ID = 'fake';
process.env.AWS_SECRET_ACCESS_KEY = 'fake';
process.env.AWS_REGION = 'us-east-1';
process.env.BCRYPT_COST = '4';
