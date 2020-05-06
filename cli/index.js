#!/usr/bin/env node

const AWS = require('aws-sdk');
const websocket = require('./websocket');
const program = require('commander');
const ssoAuth = require('@mhlabs/aws-sso-client-auth');
const storage = require('node-persist');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const EVB_CACHE_DIR = `${os.homedir()}/.evb-local`;

program.version('1.0.0', '-v, --vers', 'output the current version');
program
  .command('listen [stackName]')
  .alias('l')
  .option('-c, --compact [compact]', 'Output compact JSON on one line', 'false')
  .option(
    '--sso',
    'Authenticate with AWS SSO. Set environment variable EVB_CLI_SSO=1 for default behaviour'
  )
  .description('Initiates local consumption of a stacks EventBridge rules')
  .action(async (stackName, cmd) => {
    if (!process.env.AWS_REGION) {
      console.log("Please set environment variable AWS_REGION to your desired region. I.e us-east-1");
      return;
    }

    await authenticate();
    await init(stackName, cmd.compact.toLowerCase() === 'true');
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
  const cloudFormation = new AWS.CloudFormation();
  const evbLocalStack = await cloudFormation
    .listStackResources({ StackName: "evb-local" })
    .promise();
  const apiGatewayId = evbLocalStack.StackResourceSummaries.filter(
    p => p.LogicalResourceId === 'WebSocket'
  )[0].PhysicalResourceId;
  const token = uuidv4();
  const ws = websocket.connect(
    `wss://${apiGatewayId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/Prod`,
    token,
    stackName,
    compact
  );
  let i = 0;
  console.log("Connecting...");
  //   setInterval(() => {
  // }, 2000)
}
