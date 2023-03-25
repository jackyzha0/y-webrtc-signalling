import { WebSocketServer } from 'ws'
import http from 'http'
import process from 'process'

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

// Whether to keep the server alive after all connections have closed
// If you are running this serverless, this should probably be set to false
const PERSISTENT = true

// 1 minute
const expiryTimeout = 1000 * 60
// 5 min
const serverTimeout = 1000 * 60 * 5
const refreshRate = 1000

const port = process.env.PORT || 4444
const wss = new WebSocketServer({ noServer: true })

const server = http.createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

const topics = new Map()
const connections = new Set()

const forceClose = () => {
  console.log("Forcing shutdown...")
  process.exit()
}

if (!PERSISTENT) {
  setTimeout(forceClose, serverTimeout)
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

function getNewExpiry() {
  return (new Date()).getTime() + expiryTimeout
}

const onconnection = conn => {
  connections.add(conn)
  console.log(`Received connection! Now at ${connections.size} connections`)
  const subscribedTopics = new Set()
  let closed = false

  let ttl = getNewExpiry()
  setInterval(() => {
    if (new Date().getTime() > ttl) {
      // force close
      conn.close()
    }
  }, refreshRate)

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
    console.log(`Connection closed! Now managing ${connections.size} connections`)
    closed = true

    if (!PERSISTENT && connections.size === 0) {
      forceClose()
    }
  })

  conn.on('message', message => {
    message = JSON.parse(message.toString())
    if (message && message.type && !closed) {
      const messageTopics = message.topics ?? []
      switch (message.type) {
        case 'subscribe':
          messageTopics.forEach(topicName => {
            if (typeof topicName === 'string') {
              const topic = topics.get(topicName) ?? new Set()
              topic.add(conn)
              subscribedTopics.add(topicName)
              topics.set(topicName, topic)
            }
          })
          ttl = getNewExpiry()
          break
        case 'unsubscribe':
          messageTopics.forEach(topicName => {
            const subs = topics.get(topicName)
            if (subs) {
              subs.delete(conn)
            }
          })
          ttl = getNewExpiry()
          break
        case 'publish':
          if (message.topic) {
            const receivers = topics.get(message.topic)
            if (receivers) {
              receivers.forEach(receiver => send(receiver, message))
            }
          }
          ttl = getNewExpiry()
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

server.listen(port, "127.0.0.1")
console.log('Signalling server running on localhost:', port)
