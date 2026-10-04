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

## Use in a browser

The same package has a browser entry point. Your application backend keeps the
service API key and asks the Engine for a short-lived grant for the signed-in
user's specific thread key and actions. The browser receives only that grant.

Configure the Engine with `THREADIFY_BROWSER_ORIGINS=https://app.example.com`
(comma-separated for more than one exact origin). HTTP origins are accepted only
for localhost or loopback development.

On your authenticated backend route, request a grant from the Engine:

```javascript
const response = await fetch(`${engineUrl}/v1/browser-tokens`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.THREADIFY_API_KEY
  },
  body: JSON.stringify({
    origin: 'https://app.example.com',
    actions: ['startThread', 'recordThreadEvent', 'recordBrowserAction', 'waitFor'],
    thread_keys: [`order:${orderId}`],
    thread_ids: [],
    ttl_seconds: 300
  })
});
// Return the Engine's { token, expires_at } JSON to this signed-in user.
```

The backend must authorize the user for `orderId` before issuing the grant.
Then use it in the browser:

```javascript
import { ThreadifyBrowser } from '@threadify/sdk/browser';

const connection = await ThreadifyBrowser.connect({
  engineUrl: 'https://engine.example.com',
  getAccessToken: async () => {
    const response = await fetch('/api/threadify/browser-token', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not obtain Threadify access');
    return response.json();
  }
});

const thread = await connection.thread(`order:${orderId}`);
await thread.step('order_placed').addContext({ orderId }).success();
```

### Capture browser actions

Auto capture is opt in. It records clicks, form submissions, and field changes
on the current thread. A component can narrow capture to its own include list;
the nearest registered component controls its descendants. An action mapped to
a contract step records that step on the same thread. Other actions are stored
as activity evidence and may be classified as step candidates or substeps;
they do not complete contract steps.

```javascript
const capture = ThreadifyBrowser.autoCapture({ thread });

// Register when the component mounts; call dispose when it unmounts.
const dispose = capture.scope(checkoutElement, {
  include: ['#place-order', '#check-availability'],
  steps: { '#place-order': 'order_placed' }
});

// The button can supply bounded context for the mapped step:
// <button id="place-order" data-threadify-context-order-id="ORD-12345">
//   Place order
// </button>

// Manual evidence works without auto capture, including on threads without a contract.
await thread.captureAction('shipping_quote_requested', { quoteId: 'q42' });
dispose();
capture.stop();
```

`include` accepts action names from `data-threadify-action` or CSS selectors.
`data-threadify-step="order_placed"` is another way to map an included action.
Alternatively, an Engine administrator can set an action-to-step rule in
the contract version page under **Input config**, one
`action=contract_step` per line. Comma-separated actions can share a step, as
in `click_a,click_b=contract_step`. The website then only needs auto capture and
the active thread; it does not need to declare that step mapping. Rules apply
to future actions on matching contracted threads and are validated by the
Engine. Earlier activity stays as evidence rather than becoming completed
steps retroactively. A capture result reports `mapped_step` and its `stepId`,
or `mapping_rejected` with a reason when the step could not be recorded.
Publishing a new contract version copies links whose target steps still exist.
Input config covers OTel spans and auto-captured browser actions; direct SDK
events bypass these mappings.
Forms may mark specific inputs with `data-threadify-context="fieldName"` to
add their values; password and file inputs are skipped. Auto capture does not
read unmarked input values. Capture continues across SPA route changes while
the registered root stays mounted; re-register component scopes on mount and
dispose them on unmount. For full-page navigation, resume the same thread key
on each page, as in the live sample.

The SDK renews the grant before it expires by calling `getAccessToken` again.
The Engine checks the grant, origin, source key, action, and thread scope on
every browser operation. Browser grants do not enable global notifications or
Engine GraphQL reads. For archived reads, set `graphqlUrl` to a same-origin
application endpoint that authenticates the user and enforces thread access
before proxying approved queries. Do not expose an unrestricted service-key
GraphQL proxy to the browser.

The [live browser sample](examples/browser-live/README.md) carries one
contracted thread across four pages and displays `can`, `should`, and `next`
through a session-scoped backend endpoint.

## Track a workflow

```javascript
// Create or resume a thread by an application-owned key.
const thread = await connection.thread('order:ORD-12345', { label: 'Order checkout' });

await thread.step('order_placed')
  .addContext({ orderId: 'ORD-12345', amount: 99.99 })
  .success();
```

## Contract decisions

```javascript
const paths = await thread.next(); // All currently possible Contract paths.
const eligibility = await thread.can({ goal: 'I want to process a refund' });

if (eligibility.allowed) {
  const advice = await thread.should({ action: eligibility.stepName }); // Optional advice.
  const grant = await thread.waitFor(eligibility.stepName); // Atomic claim.
  // Execute the action, then report its outcome through thread.step(...).
}
```

`can()`, `should()`, and `next()` are read-only snapshots. `next()` does not
rank paths. An ambiguous goal returns `status: "uncertain"`; fresh prerequisites
may return `status: "requires_claim"`. Always use `waitFor()` before a guarded
side effect, even after `can()` reports `allowed`.

See [docs.threadify.dev](https://docs.threadify.dev) for contracts, joining
threads, the Data Retrieval API, real-time notifications, the OpenTelemetry
exporter, and step waits.

## Support

- 📖 **Documentation**: [docs.threadify.dev](https://docs.threadify.dev)
- 📧 **Email**: [support@threadify.dev](mailto:support@threadify.dev)

## License

MIT
