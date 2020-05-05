#!/usr/bin/env node

const AWS = require('aws-sdk');
const cloudFormation = new AWS.CloudFormation();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();
const sts = new AWS.STS();
const { v4: uuidv4 } = require('uuid');
const websocket = require('./websocket');

(async () => {
  const identity = await sts.getCallerIdentity().promise();
  const accountId = identity.Account;
  const evbLocalStack = await cloudFormation
    .listStackResources({ StackName: 'evb-local' })
    .promise();

  const eventConsumerName = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'EventConsumer'
  )[0].PhysicalResourceId;
  const eventConsumerRole = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'EventConsumerRole'
  )[0].PhysicalResourceId;
  const apiGatewayId = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'WebSocket'
  )[0].PhysicalResourceId;
  const stackName = process.argv[2];
  const logicalResourceId = process.argv[3];
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
  const token = uuidv4();
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
      const newRuleName = `evb-local-${new Date().getTime()}`;
      ruleNames.push(newRuleName);
      const putRuleresponse = await eventBridge
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
          const targetPhysicalId = target.Arn.split(":").slice(-1)[0];
        const targetLogicalIds = stackResourcesResponse.StackResourceSummaries.filter(p=>p.PhysicalResourceId  === targetPhysicalId);
        const targetLogicalId = (targetLogicalIds && targetLogicalIds.length) ? targetLogicalIds[0].LogicalResourceId : targetPhysicalId || "UnknownTarget";
        const t = {
          Id: `${eventConsumerName}-${uuidv4()}`.substring(0, 64),
          Arn: `arn:aws:lambda:${process.env.AWS_REGION}:${accountId}:function:${eventConsumerName}`,
          Input: target.Input,
          InputPath: target.InputPath
        };
        if (target.InputTransformer) {
          t.InputTransformer = target.InputTransformer;
          t.InputTransformer.InputTemplate = `{ \"Target\": \"${targetLogicalId}\", \"Token\": \"${token}\", \"Body\": ` + target.InputTransformer.InputTemplate + "}" ;
        } else {
          t.InputTransformer = {
            InputPathsMap: { Body: t.InputPath || "$" },
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
  const ws = websocket.connect(
    `wss://${apiGatewayId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/Prod`,
    ruleNames, token
  );
  let i = 0;
  console.log('CTRL+C to exit');
  //   setInterval(() => {
  // }, 2000)
})();
