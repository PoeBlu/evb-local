const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
async function handler(event, context) {
  const items = await dynamoDb
    .delete({
      Key: { id: event.requestContext.connectionId },
      TableName: process.env.ConnectionsTable
    })
    .promise();
    console.log(JSON.stringify(items));
    for (const item of items.Attributes) {
      console.log(item);
    }
    return { statusCode: 200, body: "Disconnected!" };
}

exports.handler = handler;
