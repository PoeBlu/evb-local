var WebSocketClient = require('websocket').client;

var client = new WebSocketClient();
const WebSocket = require('ws');

function connect(url, ruleNames, token) {
  const ws = new WebSocket(url);

  ws.on('open', function open() {
    const payload = JSON.stringify({ action: 'register', rules: ruleNames, token: token });
    ws.send(payload, err => {
      if (err) {
        console.log(err);
      }
    });
  });

  ws.on('message', function incoming(data) {
    console.log(data);
  });

  return ws;
}

module.exports = {
  connect
};
