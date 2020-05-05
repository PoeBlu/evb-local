var WebSocketClient = require('websocket').client;

var client = new WebSocketClient();
const WebSocket = require('ws');

function connect(url, ruleNames, token, compact) {
  const ws = new WebSocket(url);

  ws.on('open', function open() {
    const payload = JSON.stringify({
      action: 'register',
      rules: ruleNames,
      token: token
    });
    ws.send(payload, err => {
      if (err) {
        console.log(err);
      }
    });
  });

  ws.on('message', function incoming(data) {
    const obj = JSON.parse(data);
    delete obj.Token;
    if (compact) {
      console.log(JSON.stringify(obj));
    } else {
      console.log(JSON.stringify(obj, null, 2));
    }
  });

  return ws;
}

module.exports = {
  connect
};
