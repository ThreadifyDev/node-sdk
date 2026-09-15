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

## Support

- 📖 **Documentation**: [docs.threadify.dev](https://docs.threadify.dev)
- 📧 **Email**: [support@threadify.dev](mailto:support@threadify.dev)

## License

MIT


## Optional waits

```js
// Permission before the operation; consumes one eligible invocation.
await thread.waitFor('charge_payment', { timeout: 10000 });
const outcome = await chargePayment();

// Optionally wait for the validation of this exact reported event.
const result = await thread.step('charge_payment')
  .addContext(outcome)
  .success('Charged', { waitFor: true });
console.log(result.validation.decision); // passed
```

`.failed(message, { waitFor: true })` and `.error(...)` support the same option.
Reports remain asynchronous by default. Validation violations, unavailable
validation, timeouts and disconnections reject the wait. The pre-execution wait
checks known flow state; future input and outcome checks still need the event.
For repeated actions use the contract clause
`And step "approval" must succeed before each invocation`.

Keep the grant returned by `waitFor` to call `grant.cancel()` if you decide not
to execute. Cancellation does not restore a consumed prerequisite. Wait errors
carry `invocationId` for recovering an uncertain permission request; errors after
a server-reported validation timeout carry `stepId` for
`thread.waitForValidation(stepName, stepId)`. Both waits accept `timeout` and
`signal`. Report errors retain `idempotencyKey` when an acknowledgement has not
arrived; keep the original payload and key for reconciliation without recording
a new event. Pass an explicit UUID `invocationId` to `waitFor` if your application
persists it for crash recovery. An outstanding invocation is not automatically
released when a local wait times out.

For an existing OTel funnel, put `grant.invocationId` in the individual operation
span's `threadify.invocation_id` attribute. The exporter/OTLP endpoint then links
its normal outcome to the grant without resending business content.

Each wait uses one pending request; the SDK does not poll. Reports with
`waitFor: true` receive their validation in the original submission response.
The Engine continues ingesting events on the same socket while waiting, waking
on validation changes. `timeout` is the caller's wait deadline and is also sent
as the Engine wait budget. There is no additional transport grace. A busy Node
event loop can delay timer delivery. A late response cannot turn an expired wait
into permission to proceed. Timeout/abort requests server cancellation, but does
not undo an already recorded event or granted permission.
