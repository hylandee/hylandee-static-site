// @ts-check
const dynamodbLocal = require('dynamodb-local');

const PORT = 8001;

module.exports = async function globalTeardown() {
  try {
    dynamodbLocal.stop(PORT);
  } catch (_) {}
};
