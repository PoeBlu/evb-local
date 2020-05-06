const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');

const apigateway = new AWS.ApiGatewayManagementApi({
  endpoint: `https://${process.env.ApiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/Prod/`
});

const dynamoDb = new AWS.DynamoDB.DocumentClient();
async function handler(event, context) {
  console.log(event);
  console.log(JSON.parse(event.body).rules);
  const body = JSON.parse(event.body);
  const token = body.token;
  const stackName = body.stack;

  const cloudFormation = new AWS.CloudFormation();
  const eventBridge = new AWS.EventBridge();

  const accountId = process.env.AccountId;
  const evbLocalStack = await cloudFormation
    .listStackResources({ StackName: process.env.StackName })
    .promise();

  const eventConsumerName = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'EventConsumer'
  )[0].PhysicalResourceId;
  const stackResourcesResponse = await cloudFormation
    .listStackResources({ StackName: stackName })
    .promise();
  let nextToken = stackResourcesResponse.NextToken;
  while (nextToken) {
    const more = await cloudFormation
      .listStackResources({ StackName: stackName, NextToken: nextToken })
      .promise();
    stackResourcesResponse.StackResourceSummaries.push(
      ...more.StackResourceSummaries
    );
    nextToken = more.NextToken;
  }
  const ruleNames = [];
  for (const resource of stackResourcesResponse.StackResourceSummaries.filter(
    p => p.ResourceType.startsWith('AWS::Events::Rule')
  )) {
    const busName = resource.PhysicalResourceId.split('|')[0];
    const ruleName = resource.PhysicalResourceId.split('|')[1];
    if (ruleName) {
      const ruleResponse = await eventBridge
        .describeRule({ EventBusName: busName, Name: ruleName })
        .promise();
      const ruleTargets = await eventBridge
        .listTargetsByRule({ EventBusName: busName, Rule: ruleResponse.Name })
        .promise();
      const newRuleName = `evb-local-${busName}-${new Date().getTime()}`;
      ruleNames.push(newRuleName);
      await eventBridge
        .putRule({
          EventBusName: busName,
          EventPattern: ruleResponse.EventPattern,
          Name: newRuleName,
          State: 'ENABLED',
          ScheduleExpression: ruleResponse.ScheduleExpression
        })
        .promise();
      const targets = [];
      for (const target of ruleTargets.Targets) {
        const targetPhysicalId = target.Arn.split(':').slice(-1)[0];
        const targetLogicalIds = stackResourcesResponse.StackResourceSummaries.filter(
          p => p.PhysicalResourceId === targetPhysicalId
        );
        const targetLogicalId =
          targetLogicalIds && targetLogicalIds.length
            ? targetLogicalIds[0].LogicalResourceId
            : targetPhysicalId || 'UnknownTarget';
        const t = {
          Id: `${eventConsumerName}-${uuidv4()}`.substring(0, 64),
          Arn: `arn:aws:lambda:${process.env.AWS_REGION}:${accountId}:function:${eventConsumerName}`,
          Input: target.Input,
          InputPath: target.InputPath
        };
        if (target.InputTransformer) {
          t.InputTransformer = target.InputTransformer;
          t.InputTransformer.InputTemplate =
            `{ \"Target\": \"${targetLogicalId}\", \"Token\": \"${token}\", \"Body\": ` +
            target.InputTransformer.InputTemplate +
            '}';
        } else {
          t.InputTransformer = {
            InputPathsMap: { Body: t.InputPath || '$' },
            InputTemplate: `{ "Target": "${targetLogicalId}", "Token": "${token}", "Body": <Body> }`
          };

          if (t.InputPath) {
            t.InputPath = null;
          }
        }

        targets.push(t);
      }
      const resp = await eventBridge
        .putTargets({
          EventBusName: busName,
          Rule: newRuleName,
          Targets: targets
        })
        .promise();
    }
  }

  await dynamoDb
    .put({
      Item: { id: event.requestContext.connectionId, rules: ruleNames, token: token },
      TableName: process.env.ConnectionsTable
      
    })
    .promise();

    const resp = await apigateway
    .postToConnection({
      ConnectionId: event.requestContext.connectionId,
      Data: "Connected!"
    })
    .promise();

    
    return { statusCode: 200 };
}

exports.handler = handler;
