const AWS = require("aws-sdk");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
async function handler(event, context) {
  console.log(event);
  console.log(JSON.parse(event.body).rules);
  const body = JSON.parse(event.body);
  await dynamoDb
    .put({
      Item: { id: event.requestContext.connectionId, rules: body.rules, token: body.token },
      TableName: process.env.ConnectionsTable
      
    })
    .promise();
    
    return { statusCode: 200 };
}

exports.handler = handler;
