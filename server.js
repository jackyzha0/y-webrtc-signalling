import { WebSocketServer } from 'ws'
import http from 'http'

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

// Whether to keep the server alive after all connections have closed
// If you are running this serverless, this should probably be set to false
const PERSISTENT = false
const pingTimeout = 30000

const port = process.env.PORT || 4444
const wss = new WebSocketServer({ noServer: true })

const server = http.createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

const topics = new Map()
const connections = new Set()

const forceClose = () => {
  for (const conn of connections) {
    conn.destroy();
    connections.delete(conn);
  }
  server.close(callback);
}

const send = (conn, message) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    conn.close()
  }
  try {
    conn.send(JSON.stringify(message))
  } catch (e) {
    conn.close()
  }
}

const onconnection = conn => {
  connections.add(conn)
  const subscribedTopics = new Set()
  let closed = false
  // Check if connection is still alive
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close()
      clearInterval(pingInterval)
    } else {
      pongReceived = false
      try {
        conn.ping()
      } catch (e) {
        conn.close()
      }
    }
  }, pingTimeout)
  conn.on('pong', () => {
    pongReceived = true
  })
  conn.on('close', () => {
    subscribedTopics.forEach(topicName => {
      const subs = topics.get(topicName) || new Set()
      subs.delete(conn)
      if (subs.size === 0) {
        topics.delete(topicName)
      }
    })
    subscribedTopics.clear()
    connections.delete(conn)
    closed = true

    if (!PERSISTENT && connections.size === 0) {
      forceClose()
    }
  })
  conn.on('message', message => {
    message = JSON.parse(message.toString())
    console.log(message)
    if (message && message.type && !closed) {
      const messageTopics = message.topics ?? []
      switch (message.type) {
        case 'subscribe':
          messageTopics.forEach(topicName => {
            if (typeof topicName === 'string') {
              // add conn to topic
              const topic = topics.get(topicName) ?? new Set()
              topic.add(conn)
              subscribedTopics.add(topicName)
              topics.set(topicName, topic)
            }
          })
          break
        case 'unsubscribe':
          messageTopics.forEach(topicName => {
            const subs = topics.get(topicName)
            if (subs) {
              subs.delete(conn)
            }
          })
          break
        case 'publish':
          if (message.topic) {
            const receivers = topics.get(message.topic)
            if (receivers) {
              receivers.forEach(receiver =>
                send(receiver, message)
              )
            }
          }
          break
        case 'ping':
          send(conn, { type: 'pong' })
      }
    }
  })
}
wss.on('connection', onconnection)


server.on('upgrade', (request, socket, head) => {
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port)

console.log('Signaling server running on localhost:', port)
