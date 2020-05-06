var WebSocketClient = require('websocket').client;

var client = new WebSocketClient();
const WebSocket = require('ws');

function connect(url, token, stackName, compact) {
  const ws = new WebSocket(url);

  ws.on('open', function open() {
    const payload = JSON.stringify({
      action: 'register',
      token: token,
      stack: stackName
    });
    ws.send(payload, err => {
      if (err) {
        console.log(err);
      }
    });
  });

  ws.on('message', function incoming(data) {
    try {
      const obj = JSON.parse(data);
      delete obj.Token;
      if (compact) {
        console.log(JSON.stringify(obj));
      } else {
        console.log(JSON.stringify(obj, null, 2));
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
