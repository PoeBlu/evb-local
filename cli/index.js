#!/usr/bin/env node

const AWS = require('aws-sdk');
const cloudFormation = new AWS.CloudFormation();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();
const sts = new AWS.STS();
const { v4: uuidv4 } = require('uuid');
const websocket = require('./websocket');
const program = require('commander');
const ssoAuth = require('@mhlabs/aws-sso-client-auth');
const storage = require('node-persist');
const os = require('os');

const EVB_CACHE_DIR = `${os.homedir()}/.evb-local`;

program.version('1.0.11', '-v, --vers', 'output the current version');
program
  .command('listen [stackName]')
  .alias('l')
  .option('-c, --compact [compact]', 'Output compact JSON on one line', 'false')
  .option(
    '--sso',
    'Authenticate with AWS SSO. Set environment variable EVB_CLI_SSO=1 for default behaviour'
  )
  .description('Initiates local consumption of a stacks EventBridge rules')
  .action(async (stackName, cmd)  => {
    await authenticate();
    await init(stackName, cmd.compact.toLowerCase() === "true");
  });

program
  .command('configure-sso')
  .option('-a, --account-id <accountId>', 'Account ID')
  .option('-u, --start-url <startUrl>', 'AWS SSO start URL')
  .option('--region <region>', 'AWS region')
  .option('--role <role>', 'Role to get credentials for')
  .description('Configure authentication with AWS Single Sign-On')
  .action(async cmd => {
    await storage.init({
      dir: EVB_CACHE_DIR,
      expiredInterval: 0
    });

    await storage.setItem('evb-cli-sso', {
      accountId: cmd.accountId,
      startUrl: cmd.startUrl,
      region: cmd.region,
      role: cmd.role
    });
  });
program.on('command:*', () => {
  const command = program.args[0];

  console.error(`Unknown command '${command}'`);
  process.exit(1);
});

program.parse(process.argv);

if (process.argv.length < 3) {
  program.help();
}
async function authenticate() {
  await storage.init({
    dir: EVB_CACHE_DIR
  });
  const ssoConfig = await storage.getItem('evb-cli-sso');
  if (ssoConfig) {
    await ssoAuth.configure({
      clientName: 'evb-cli',
      startUrl: ssoConfig.startUrl,
      accountId: ssoConfig.accountId,
      region: ssoConfig.region
    });
    AWS.config.update({
      credentials: await ssoAuth.authenticate(ssoConfig.role)
    });
  }
}

async function init(stackName, compact) {
  const identity = await sts.getCallerIdentity().promise();
  const accountId = identity.Account;
  const evbLocalStack = await cloudFormation
    .listStackResources({ StackName: 'evb-local' })
    .promise();

  const eventConsumerName = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'EventConsumer'
  )[0].PhysicalResourceId;
  const apiGatewayId = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'WebSocket'
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
  const ws = websocket.connect(
    `wss://${apiGatewayId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/Prod`,
    ruleNames,
    token,
    compact
  );
  let i = 0;
  console.log('CTRL+C to exit');
  //   setInterval(() => {
  // }, 2000)
}
