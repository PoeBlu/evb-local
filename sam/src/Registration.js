const AWS = require('aws-sdk');
const localRuleCreator = require('./builders/localRuleCreator');
const stackRuleCreator = require('./builders/stackRuleCreator');

const apigateway = new AWS.ApiGatewayManagementApi({
  endpoint: `https://${process.env.ApiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/Prod/`
});

const dynamoDb = new AWS.DynamoDB.DocumentClient();


async function handler(event, context) {
  console.log(event);
  console.log(JSON.parse(event.body).rules);
  const body = JSON.parse(event.body);
  const token = body.token;
  const localRule = body.localRule;
  let ruleNames;
  if (localRule) {
    ruleNames = await localRuleCreator.create(event);
  } else {
    ruleNames = await stackRuleCreator.create(event);
  }

  await dynamoDb
    .put({
      Item: {
        id: event.requestContext.connectionId,
        rules: ruleNames,
        token: token
      },
      TableName: process.env.ConnectionsTable
    })
    .promise();

  await apigateway
    .postToConnection({
      ConnectionId: event.requestContext.connectionId,
      Data: 'Connected!'
    })
    .promise();

  return { statusCode: 200 };
}

exports.handler = handler;
