const WebSocket = require('ws');
const AWS = require('aws-sdk');

function connect(url, token, stackName, compact, sam, rule) {
  const lambda = new AWS.Lambda({
    endpoint: 'http://127.0.0.1:3001/',
    sslEnabled: false
  });
  const ws = new WebSocket(url);

  ws.on('open', function open() {
    const payload = JSON.stringify({
      action: 'register',
      token: token,
      stack: stackName,
      localRule: rule
    });
    ws.send(payload, (err) => {
      if (err) {
        console.log(err);
      }
    });
  });

  ws.on('message', async function incoming(data) {
    try {
      const obj = JSON.parse(data);
      delete obj.Token;

      let presentationObject = obj;
      if (rule) {
        presentationObject = obj.Body;
      }
      if (compact) {
        console.log(JSON.stringify(presentationObject));
      } else {
        console.log(JSON.stringify(presentationObject, null, 2));
      }
      if (sam) {
        try {
          await lambda
            .invoke({
              FunctionName: obj.Target,
              Payload: JSON.stringify(obj.Body)
            })
            .promise();
        } catch (err) {
          console.log(err);
        }
      }
    } catch {
      console.log(data);
    }
  });

  return ws;
}

module.exports = {
  connect
};
