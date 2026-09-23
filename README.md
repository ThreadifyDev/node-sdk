# Threadify SDK

**Every customer request tells a story. Turn it into intelligence.**

Threadify turns customer requests into live execution graphs. Support answers "what happened?" in seconds. Operations validates business logic in real-time. AI agents act with complete context.

## 📚 Documentation

**For complete documentation, installation guide, and examples:**

👉 **[docs.threadify.dev/core-concepts](https://docs.threadify.dev/core-concepts)**

## 🏠 Homepage

👉 **[threadify.dev](https://threadify.dev)**

## Quick Install

```bash
npm install @threadify/sdk
```

## Connect to your Engine

```javascript
import { Threadify } from '@threadify/sdk';

const connection = await Threadify.connect(
  process.env.THREADIFY_API_KEY,
  'my-service',
  { engineUrl: 'https://threadify.example.com' }
);
```

Use the Engine URL from **Settings → Engine**. The SDK handles WebSocket and
GraphQL paths automatically. Reverse-proxy prefixes, such as
`https://example.com/threadify`, are preserved. `Threadify.create()` accepts the
same `engineUrl` option. Do not combine it with explicit transport URL options.

## Track a workflow

```javascript
// Create or resume a thread by an application-owned key.
const thread = await connection.thread('order:ORD-12345', { label: 'Order checkout' });

await thread.step('order_placed')
  .addContext({ orderId: 'ORD-12345', amount: 99.99 })
  .success();
```

See [docs.threadify.dev](https://docs.threadify.dev) for contracts, joining
threads, the Data Retrieval API, real-time notifications, the OpenTelemetry
exporter, and step waits.

## Support

- 📖 **Documentation**: [docs.threadify.dev](https://docs.threadify.dev)
- 📧 **Email**: [support@threadify.dev](mailto:support@threadify.dev)

## License

MIT
