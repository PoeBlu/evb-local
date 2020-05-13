const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const websocket = require('./websocket');

async function initStackListener(stackName, compact, sam) {
  const cloudFormation = new AWS.CloudFormation();
  const evbLocalStack = await cloudFormation
    .listStackResources({ StackName: 'evb-local' })
    .promise();
  const apiGatewayId = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'WebSocket'
  )[0].PhysicalResourceId;
  const token = uuidv4();
  websocket.connect(
    `wss://${apiGatewayId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/Prod`,
    token,
    stackName,
    compact,
    sam
  );
  console.log('Connecting...');
}

module.exports = {
  init: initStackListener
};
