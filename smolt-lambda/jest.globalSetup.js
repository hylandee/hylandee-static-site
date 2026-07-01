// @ts-check
const dynamodbLocal = require('dynamodb-local');
const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');

const PORT = 8001; // Use 8001 to avoid conflicts with any running local DynamoDB
const TABLE = 'smolt-test';

module.exports = async function globalSetup() {
  // Launch DynamoDB Local in-memory via Java (downloads JAR on first run)
  await dynamodbLocal.launch(PORT, null, [], false);

  const client = new DynamoDBClient({
    endpoint: `http://localhost:${PORT}`,
    region: 'us-east-1',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
  });

  // Wait up to 10 seconds for DynamoDB Local to be ready
  for (let i = 0; i < 20; i++) {
    try {
      await client.send(new ListTablesCommand({}));
      break;
    } catch {
      if (i === 19) throw new Error('DynamoDB Local failed to start after 10s');
      await new Promise(r => setTimeout(r, 500));
    }
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
};
