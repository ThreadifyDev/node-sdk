import { Threadify } from './src/index.js';

async function run() {
  const connection = await Threadify.connect(process.env.THREADIFY_LOCAL_API_KEY, "test", { url: "ws://localhost:8081/threads" });
  const thread = await connection.start('test-thread');
  await thread.step('test_step')
    .addContext({ myKey: { nested: 'value' } })
    .success();
  console.log("Done");
  process.exit(0);
}
run();
