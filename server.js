import { WebSocketServer } from 'ws'
import http from 'http'
import process from 'process'

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

// 1 minute
const expiryTimeout = 1000 * 60

// 5 min
const refreshRate = 1000

const port = process.env.port || 8080

const server = http.createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

const wss = new WebSocketServer({ server })
const topics = new Map()
const connections = new Set()

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
  const ttlCheckTimer = setInterval(() => {
    if (new Date().getTime() > ttl) {
      // force close
      conn.close()
    }
  }, refreshRate)

  function cleanupconn() {
    subscribedTopics.forEach(topicName => {
      const subs = topics.get(topicName) || new Set()
      subs.delete(conn)
      if (subs.size === 0) {
        topics.delete(topicName)
      }
    })
    subscribedTopics.clear()
    connections.delete(conn)
    conn.onmessage = () => {}
    clearInterval(ttlCheckTimer)
    console.log(`Connection closed! Now managing ${connections.size} connections`)
    closed = true
  }

  conn.onclose = cleanupconn
  conn.onmessage = message => {
    message = JSON.parse(message.data.toString())
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
  }
}

wss.on('connection', onconnection)

server.listen(port, () => {
  console.log('Signalling server running on localhost:', port)
})
