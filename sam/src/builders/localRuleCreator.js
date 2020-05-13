const eventBridgeClient = require("./eventBridgeClient");
const cloudFormationClient = require("./cloudFormationClient");


async function create(event) {
  const body = JSON.parse(event.body);
  const token = body.token;
  const localRule = body.localRule;

  const ruleName = eventBridgeClient.getRuleName(localRule.EventBusName);
  const eventConsumerName = await cloudFormationClient.getEventConsumerName();

  await eventBridgeClient.putRule(localRule.EventBusName, localRule, ruleName);

  const targets = [eventBridgeClient.createTarget(eventConsumerName, localRule, localRule.Target, token)];
  await eventBridgeClient.putTargets(localRule.EventBusName, ruleName, targets);

  return [ruleName];
}



module.exports = {
  create
};
